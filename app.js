// VocalMorph Pro Logic

// Estado Global
let isListening = false;
let isRecording = false;
let currentInstrument = 'violin';
let audioContext;
let stream;
let synth;
let synthMaster; // Canal maestro para el sintetizador (va a speakers y grabadora)
let recorder;
let tracks = []; // Array para guardar las pistas grabadas
let volume = new Tone.Volume(0);
let lastNote = null;
let isPlaying = false;
let silenceTimer = null;
let trackCounter = 1;

// Configuración de Instrumentos (Presets)
const instruments = {
    violin: new Tone.FMSynth({
        harmonicity: 3.01,
        modulationIndex: 14,
        oscillator: { type: "pulse" },
        envelope: { attack: 0.2, decay: 0.1, sustain: 0.9, release: 1 },
        modulation: { type: "square" },
        modulationEnvelope: { attack: 0.1, decay: 0.5, sustain: 0.5, release: 0.5 }
    }),

    cello: new Tone.MonoSynth({
        frequency: "C2",
        oscillator: { type: "sawtooth" },
        filter: { Q: 2, type: "lowpass", rollover: -12 },
        envelope: { attack: 0.3, decay: 0.3, sustain: 0.8, release: 1 },
        filterEnvelope: { attack: 0.2, decay: 0.5, sustain: 0.7, release: 2, baseFrequency: 150, octaves: 3 }
    }),

    synth: new Tone.Synth({
        oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.4 }
    })
};

// Initial Setup (Deferred until user interaction)
function setupAudioRouting() {
    synthMaster = new Tone.Gain(1);
    recorder = new Tone.Recorder();

    // Ruta: Instrumento -> synthMaster -> (Speakers + Recorder)
    // Conectamos instrumentos al master
    Object.values(instruments).forEach(inst => inst.connect(synthMaster));

    // Conectamos Master a Salida y Grabadora
    synthMaster.connect(Tone.Destination);
    synthMaster.connect(recorder);

    // Inicializar el synth actual
    synth = instruments[currentInstrument];
}

// Elementos del DOM
const startBtn = document.getElementById('start-btn');
const recordBtn = document.getElementById('record-btn');
const playAllBtn = document.getElementById('play-all-btn');
const statusDot = document.getElementById('status-dot');
const noteDisplay = document.getElementById('note-display');
const instBtns = document.querySelectorAll('.inst-btn');
const thresholdSlider = document.getElementById('threshold-slider');
const tracksContainer = document.getElementById('tracks-container');
const canvas = document.getElementById('waveform');
const ctx = canvas.getContext('2d');

// Event Listeners
startBtn.addEventListener('click', toggleListening);
recordBtn.addEventListener('click', toggleRecording);
playAllBtn.addEventListener('click', togglePlayAll);

// Cambio de instrumento
instBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        instBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (isPlaying) synth.triggerRelease();
        currentInstrument = btn.dataset.inst;
        synth = instruments[currentInstrument];
    });
});

async function toggleListening() {
    if (!isListening) {
        await startAudio();
    } else {
        stopAudio();
    }
}

async function startAudio() {
    await Tone.start();

    if (!audioContext) {
        setupAudioRouting();
    }

    try {
        // Pedir permiso y stream de audio
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Inicializar detector de pitch
        PitchDetector.init(audioContext, stream);

        isListening = true;

        // UI Updates
        startBtn.classList.add('listening');
        startBtn.innerHTML = `<span class="btn-content">🛑 Apagar Motor de Audio</span>`;
        statusDot.classList.add('active');
        recordBtn.disabled = false;

        // Loop principal
        loop();

    } catch (err) {
        console.error('Error al acceder al micrófono:', err);
        alert('Necesitamos acceso a tu micrófono para que esto funcione.');
    }
}

function stopAudio() {
    isListening = false;
    startBtn.classList.remove('listening');
    startBtn.innerHTML = `<span class="btn-content"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> Activar Micrófono</span>`;
    statusDot.classList.remove('active');
    recordBtn.disabled = true;

    if (stream) stream.getTracks().forEach(track => track.stop());
    if (isPlaying) {
        synth.triggerRelease();
        isPlaying = false;
    }
}

// --- Grabación y Pistas ---

async function toggleRecording() {
    if (!isRecording) {
        // Start Recording
        recorder.start();
        isRecording = true;
        recordBtn.classList.add('recording');
        recordBtn.innerHTML = `<span class="btn-content">⏹ Detener Grabación</span>`;
    } else {
        // Stop Recording
        isRecording = false;
        recordBtn.classList.remove('recording');
        recordBtn.innerHTML = `<span class="btn-content">⏳ Procesando MP3...</span>`;
        recordBtn.disabled = true;

        try {
            // Obtener el audio crudo (WebM)
            const recording = await recorder.stop();

            // Convertir a MP3
            const mp3Blob = await convertBlobToMp3(recording);
            const url = URL.createObjectURL(mp3Blob);

            // Crear nueva pista
            addTrack(url, mp3Blob);
        } catch (error) {
            console.error("Error en conversión MP3:", error);
            alert("Hubo un error al procesar el audio.");
        } finally {
            // Restaurar botón
            recordBtn.disabled = false;
            recordBtn.innerHTML = `<span class="btn-content">⏺ Grabar Pista</span>`;
        }
    }
}

// Función auxiliar para convertir WebM/WAV Blob -> MP3 Blob
async function convertBlobToMp3(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async function () {
            const arrayBuffer = reader.result;
            // Decodificar audio raw
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Codificar a MP3
            const mp3Blob = encodeMp3(audioBuffer);
            resolve(mp3Blob);
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
    });
}

function encodeMp3(audioBuffer) {
    const channels = 1; // Mono para simplificar y asegurar compatibilidad
    const sampleRate = audioBuffer.sampleRate;
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128); // 128kbps

    // Obtener datos del canal (promedio si es estéreo, o solo canal 0)
    // Tone.js mono synths output mono usually, but context might be stereo.
    // Let's just take the first channel or mixdown.
    const samples = audioBuffer.getChannelData(0);

    // Convertir Float32 (-1 a 1) a Int16 (-32768 a 32767)
    const sampleBlockSize = 1152;
    const mp3Data = [];

    // Convertir todo el buffer a Int16
    const samplesInt16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        // Clamp y conversión
        let s = Math.max(-1, Math.min(1, samples[i]));
        samplesInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    let remaining = samplesInt16.length;
    let i = 0;

    while (remaining >= sampleBlockSize) {
        const left = samplesInt16.subarray(i, i + sampleBlockSize);
        const mp3buf = mp3encoder.encodeBuffer(left);
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }
        remaining -= sampleBlockSize;
        i += sampleBlockSize;
    }

    // Flush último chunk
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
}

function addTrack(url, blob) {
    const trackId = trackCounter++;
    const player = new Tone.Player(url).toDestination(); // Conectar a salida
    player.loop = false;

    const track = {
        id: trackId,
        player: player,
        blob: blob,
        name: `Pista ${trackId} (${currentInstrument})`
    };

    tracks.push(track);
    renderTrackUI(track);
    playAllBtn.disabled = false;
}

function renderTrackUI(track) {
    const container = document.getElementById('tracks-container');

    // Quitar estado vacío si existe
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const div = document.createElement('div');
    div.className = 'track-item';
    div.id = `track-${track.id}`;
    div.innerHTML = `
        <div class="track-info">
            <span class="icon">🎵</span>
            <span class="track-name">${track.name}</span>
        </div>
        <div class="track-controls">
            <input type="range" min="-20" max="6" value="0" class="track-volume" data-id="${track.id}" title="Volumen">
            
            <button class="icon-btn play-single" data-id="${track.id}" title="Reproducir sola">▶</button>
            
            <button class="icon-btn download" onclick="downloadTrack(${track.id})" title="Descargar MP3">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button class="icon-btn delete" onclick="deleteTrack(${track.id})" title="Borrar">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        </div>
    `;

    container.appendChild(div);

    // Eventos para esta pista
    const volSlider = div.querySelector('.track-volume');
    volSlider.addEventListener('input', (e) => {
        track.player.volume.value = parseFloat(e.target.value);
    });

    const playBtn = div.querySelector('.play-single');
    playBtn.addEventListener('click', () => {
        if (track.player.state === "started") {
            track.player.stop();
            playBtn.innerText = "▶";
        } else {
            track.player.start();
            playBtn.innerText = "⏸";
            track.player.onstop = () => { playBtn.innerText = "▶"; };
        }
    });
}

window.downloadTrack = function (id) {
    const track = tracks.find(t => t.id === id);
    if (!track) return;

    const anchor = document.createElement("a");
    anchor.download = `${track.name}.mp3`;
    anchor.href = URL.createObjectURL(track.blob);
    anchor.click();
};

window.deleteTrack = function (id) {
    const trackIndex = tracks.findIndex(t => t.id === id);
    if (trackIndex > -1) {
        tracks[trackIndex].player.dispose(); // Limpiar memoria de Tone.js
        tracks.splice(trackIndex, 1);
        document.getElementById(`track-${id}`).remove();
    }

    if (tracks.length === 0) {
        document.getElementById('tracks-container').innerHTML = '<div class="empty-state">No hay pistas grabadas aún</div>';
        playAllBtn.disabled = true;
    }
};

function togglePlayAll() {
    const isAnyPlaying = tracks.some(t => t.player.state === "started");

    if (isAnyPlaying) {
        // Stop All
        tracks.forEach(track => {
            track.player.stop();
            // Reset icons
            const btn = document.querySelector(`#track-${track.id} .play-single`);
            if (btn) btn.innerText = "▶";
        });
        playAllBtn.innerHTML = `<span class="btn-content">▶ Reproducir Todo</span>`;
    } else {
        // Play All Unison
        const now = Tone.now() + 0.1; // Pequeño delay para sincronizar
        tracks.forEach(track => {
            track.player.start(now);
            const btn = document.querySelector(`#track-${track.id} .play-single`);
            if (btn) btn.innerText = "⏸";

            // Cuando termine, resetear icono
            track.player.onstop = () => { btn.innerText = "▶"; };
        });
        playAllBtn.innerHTML = `<span class="btn-content">⏸ Pausa</span>`;
    }
}

// --- Main Loop ---

function loop() {
    if (!isListening) return;

    requestAnimationFrame(loop);

    // 1. Detectar Pitch
    const frequency = PitchDetector.getPitch();
    const threshold = parseInt(thresholdSlider.value); // Umbral dinámico

    // 2. Visualizar Onda
    drawWaveform();

    // 3. Controlar Sintetizador
    // RMS check se hace dentro de pitch-detect pero podemos reforzar aquí si tenemos acceso al volumen
    // Por simplicidad, confiamos en la frecuencia y un rango válido

    if (frequency && frequency > 65 && frequency < 1500) { // Range check 

        const noteData = getNoteFromFrequency(frequency);
        const note = noteData.note;

        noteDisplay.innerText = note;

        if (!isPlaying) {
            synth.triggerAttack(frequency);
            isPlaying = true;
        } else {
            // Glissando
            if (synth.frequency) {
                synth.frequency.rampTo(frequency, 0.1);
            } else {
                synth.setNote && synth.setNote(note);
            }
        }

        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            if (isPlaying) {
                synth.triggerRelease();
                isPlaying = false;
                noteDisplay.innerText = "--";
            }
        }, 200);

    } else {
        // Silencio manejado por el timeout
    }
}


function drawWaveform() {
    if (!PitchDetector.analyser) return;

    const bufferLength = PitchDetector.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    PitchDetector.analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = 'rgba(10, 11, 20, 0.2)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00e5ff';
    ctx.beginPath();

    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
}
