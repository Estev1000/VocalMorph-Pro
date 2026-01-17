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

// Premium Logic
let isPremium = false;
const PREMIUM_CODE = "PRO-VOICE-2026";
const STORAGE_KEY = "vocalmorph_pro_status";

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
const recordVoiceBtn = document.getElementById('record-voice-btn');
const playAllBtn = document.getElementById('play-all-btn');
const statusDot = document.getElementById('status-dot');
const noteDisplay = document.getElementById('note-display');
const canvas = document.getElementById('waveform');
const ctx = canvas.getContext('2d');

// Event Listeners
recordVoiceBtn.addEventListener('click', toggleListening);
playAllBtn.addEventListener('click', togglePlayAll);



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
        // Usar el contexto de Tone.js en lugar de crear uno nuevo
        audioContext = Tone.context.rawContext || Tone.context;
    }

    try {
        // Verificar que mediaDevices está disponible
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Tu navegador no soporta acceso al micrófono. Por favor usa Chrome, Firefox o Edge actualizado.');
        }

        // Pedir permiso y stream de audio
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

        // Crear nodo fuente desde el stream (CRUCIAL: esto arregla 'source.connect is not a function')
        const micSource = audioContext.createMediaStreamSource(stream);

        // Inicializar detector de pitch con el source node correcto
        PitchDetector.init(audioContext, micSource);

        isListening = true;

        // UI Updates
        recordVoiceBtn.classList.add('listening');
        recordVoiceBtn.innerHTML = `<span class="btn-content">⏹ Detener</span>`;
        statusDot.classList.add('active');

        // Loop principal
        loop();

    } catch (err) {
        console.error('Error al acceder al micrófono:', err);

        let errorMsg = 'Error al acceder al micrófono.';

        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            errorMsg = 'Permiso denegado. Por favor permite el acceso al micrófono en la configuración de tu navegador.';
        } else if (err.name === 'NotFoundError') {
            errorMsg = 'No se encontró ningún micrófono. Por favor conecta un micrófono y recarga la página.';
        } else if (err.name === 'NotReadableError') {
            errorMsg = 'El micrófono está siendo usado por otra aplicación. Por favor cierra otras aplicaciones que usen el micrófono.';
        } else if (err.message) {
            errorMsg = err.message;
        }

        alert(errorMsg);
    }
}

function stopAudio() {
    isListening = false;
    recordVoiceBtn.classList.remove('listening');
    recordVoiceBtn.innerHTML = `<span class="btn-content">🎙 Grabar Voz</span>`;
    statusDot.classList.remove('active');

    if (stream) stream.getTracks().forEach(track => track.stop());
    if (isPlaying) {
        synth.triggerRelease();
        isPlaying = false;
    }
}

// --- Grabación y Pistas ---

async function toggleRecording() {
    // Premium Check (Limit 1 track for free users)
    if (!isPremium && tracks.length >= 1 && !isRecording) {
        document.getElementById('premium-modal').classList.remove('hidden');
        return;
    }

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
        if (mp3buf.length > 0) mp3Data.push(mp3buf);
        remaining -= sampleBlockSize;
        i += sampleBlockSize;
    }
    // Flush último chunk
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
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
    if (!isPremium) {
        document.getElementById('premium-modal').classList.remove('hidden');
        return;
    }

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
        tracks.forEach(t => {
            t.player.stop();
            // Reset icons
            const btn = document.querySelector(`#track-${t.id} .play-single`);
            if (btn) btn.innerText = "▶";
        });
        playAllBtn.innerHTML = `<span class="btn-content">▶ Reproducir Todo</span>`;
    } else {
        // Play All Unison
        const now = Tone.now() + 0.1; // Pequeño delay para sincronizar
        tracks.forEach(t => {
            t.player.start(now);
            const btn = document.querySelector(`#track-${t.id} .play-single`);
            if (btn) btn.innerText = "⏸";

            // Cuando termine, resetear icono
            t.player.onstop = () => { btn.innerText = "▶"; };
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

    // 2. Visualizar Onda
    drawWaveform();

    // 3. Controlar Sintetizador
    if (frequency && frequency > 65 && frequency < 1500) { // Range check 

        if (noteDisplay) noteDisplay.innerText = frequency.toFixed(1) + ' Hz';

        if (!isPlaying) {
            synth.triggerAttack(frequency);
            isPlaying = true;
        } else {
            // Glissando
            if (synth.frequency) {
                synth.frequency.rampTo(frequency, 0.1);
            }
        }

        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            if (isPlaying) {
                synth.triggerRelease();
                isPlaying = false;
                if (noteDisplay) noteDisplay.innerText = "--";
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
    requestAnimationFrame(drawWaveform);
}

// --- Premium Init Logic ---
function initPremium() {
    const savedStatus = localStorage.getItem(STORAGE_KEY);
    if (savedStatus) {
        const data = JSON.parse(savedStatus);
        if (new Date().getTime() - data.timestamp < 30 * 24 * 3600 * 1000) enablePremiumMode();
    }

    // Auto-activación
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('pago') === 'aprobado') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, timestamp: new Date().getTime() }));
        enablePremiumMode();

        const modal = document.getElementById('premium-modal');
        modal.classList.remove('hidden');
        modal.querySelector('.modal-content').innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div style="font-size: 4rem; margin-bottom: 1rem;">🎉</div>
                <h2 style="color: #00e676; margin-bottom: 0.5rem;">¡Suscripción Activada!</h2>
                <button id="close-success-btn" style="background: #00e676; color: #000; border: none; padding: 1rem 2rem; border-radius: 50px; font-weight: bold; cursor: pointer; margin-top:1rem;">Comenzar</button>
            </div>
        `;
        document.getElementById('close-success-btn').addEventListener('click', () => {
            modal.classList.add('hidden');
            window.history.replaceState({}, document.title, window.location.pathname);
        });
    }

    document.getElementById('premium-trigger').addEventListener('click', () => document.getElementById('premium-modal').classList.remove('hidden'));
    document.querySelector('.modal-close').addEventListener('click', () => document.getElementById('premium-modal').classList.add('hidden'));
    const actBtn = document.getElementById('activate-btn');
    if (actBtn) actBtn.addEventListener('click', attemptActivation);
}

function attemptActivation() {
    if (document.getElementById('activation-code').value.trim() === PREMIUM_CODE) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, timestamp: new Date().getTime() }));
        enablePremiumMode();
        alert("¡Activado!");
        document.getElementById('premium-modal').classList.add('hidden');
    }
}

function enablePremiumMode() {
    isPremium = true;
    const btn = document.getElementById('premium-trigger');
    btn.innerText = "⚡ PRO";
    btn.disabled = true;
}

// Initialize Premium on load
initPremium();

