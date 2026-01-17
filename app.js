// VocalMorph Pro Logic (Offline Workflow - Silent Recording)

// Estado Global
let isRecording = false;
let audioContext;
let stream;
let micSource; // Nodo del micrófono
let voiceRecorder; // MediaRecorder nativo
let pendingVoiceBlob = null; // Audio temporal esperando transformación
let tracks = [];
let trackCounter = 1;
let animationId;

// Premium Logic
let isPremium = false;
const PREMIUM_CODE = "PRO-VOICE-2026";
const STORAGE_KEY = "vocalmorph_pro_status";

// Instrumentos (Tone.js)
const instruments = {
    violin: new Tone.FMSynth({
        harmonicity: 3.01, modulationIndex: 14, oscillator: { type: "pulse" },
        envelope: { attack: 0.2, decay: 0.1, sustain: 0.9, release: 1 },
        modulation: { type: "square" }, modulationEnvelope: { attack: 0.1, decay: 0.5, sustain: 0.5, release: 0.5 }
    }).toDestination(), // Conectados solo para reproducción de pistas finales

    cello: new Tone.MonoSynth({
        frequency: "C2", oscillator: { type: "sawtooth" }, filter: { Q: 2, type: "lowpass", rollover: -12 },
        envelope: { attack: 0.3, decay: 0.3, sustain: 0.8, release: 1 },
        filterEnvelope: { attack: 0.2, decay: 0.5, sustain: 0.7, release: 2, baseFrequency: 150, octaves: 3 }
    }).toDestination(),

    synth: new Tone.Synth({
        oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.4 }
    }).toDestination()
};

// DOM Elements
const recordVoiceBtn = document.getElementById('record-voice-btn');
const playAllBtn = document.getElementById('play-all-btn');
const tracksContainer = document.getElementById('tracks-container');
const statusDot = document.getElementById('status-dot');
const noteDisplay = document.getElementById('note-display');
const canvas = document.getElementById('waveform');
const ctx = canvas.getContext('2d');
const transformModal = document.getElementById('transform-modal');
const transformCloseBtn = document.querySelector('.modal-close-transform');

// Event Listeners
recordVoiceBtn.addEventListener('click', toggleVoiceRecording);
playAllBtn.addEventListener('click', togglePlayAll);
if (transformCloseBtn) transformCloseBtn.addEventListener('click', () => transformModal.classList.add('hidden'));

// --- Funciones Principales ---

async function initAudioEngine() {
    // 1. Iniciar Tone.js (Desbloquea AudioContext)
    await Tone.start();

    // 2. Obtener/Crear Contexto Seguro
    if (!audioContext) {
        audioContext = Tone.context.rawContext || Tone.context;
    }

    // Resume si está suspendido (Fix iOS/Chrome)
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    // 3. Obtener Micrófono (Configuración Compatible)
    if (!stream) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Navegador no compatible.");
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

        // Crear Source Node (Importante para PitchDetector)
        micSource = audioContext.createMediaStreamSource(stream);

        // NO CONECTAMOS micSource a destination. SILENCIO TOTAL mientras se graba.
        // Solo lo conectamos al analizador.
        PitchDetector.init(audioContext, micSource);
    }
}

async function toggleVoiceRecording() {
    // Premium Check
    if (!isPremium && tracks.length >= 1 && !isRecording) {
        document.getElementById('premium-modal').classList.remove('hidden');
        return;
    }

    if (!isRecording) {
        // --- INICIAR GRABACIÓN ---
        try {
            await initAudioEngine(); // Asegurar audio listo

            // Preparar Grabadora Nativa (MediaRecorder)
            let options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { mimeType: 'audio/webm' }; // Fallback
                if (!MediaRecorder.isTypeSupported(options.mimeType)) options = undefined; // Default
            }

            voiceRecorder = new MediaRecorder(stream, options);
            let chunks = [];

            voiceRecorder.ondataavailable = e => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            voiceRecorder.onstop = () => {
                const type = voiceRecorder.mimeType || 'audio/webm';
                pendingVoiceBlob = new Blob(chunks, { type: type });

                // Abrir Modal de Transformación
                openTransformModal();
            };

            voiceRecorder.start();
            isRecording = true;

            // Iniciar Visualizador (Solo visual, sin audio)
            loop();

            // UI
            recordVoiceBtn.classList.add('listening');
            recordVoiceBtn.innerHTML = `<span class="btn-content">⏹ Detener Grabación</span>`;
            document.querySelector('.status-text').innerText = "Grabando Silenciosamente...";
            statusDot.classList.add('active');

        } catch (err) {
            console.error(err);
            alert("Error de micrófono: " + err.message);
        }

    } else {
        // --- DETENER GRABACIÓN ---
        if (voiceRecorder && voiceRecorder.state !== 'inactive') {
            voiceRecorder.stop();
        }
        isRecording = false;
        cancelAnimationFrame(animationId); // Detener visualizador

        // UI Reset
        recordVoiceBtn.classList.remove('listening');
        recordVoiceBtn.innerHTML = `<span class="btn-content">🎙 Grabar Voz</span>`;
        document.querySelector('.status-text').innerText = "Voz capturada. Elige instrumento.";
        statusDot.classList.remove('active');
        if (noteDisplay) noteDisplay.innerText = "--";

        // Limpiar canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// --- Visual Loop (Solo Onda, Sin Sonido) ---
function loop() {
    if (!isRecording) return;
    animationId = requestAnimationFrame(loop);

    // 1. Dibujar Onda
    drawWaveform();

    // 2. Opcional: Mostrar Nota detectada (Solo Visual)
    // No disparamos synth.triggerAttack aquí
    const freq = PitchDetector.getPitch();
    if (freq && freq > 65 && freq < 1500 && noteDisplay) {
        // Podríamos mostrar la nota aquí si tuvieramos la función getNote,
        // por ahora mostramos Hz o nada para mantenerlo simple.
        // noteDisplay.innerText = Math.round(freq) + " Hz"; 
    }
}

function drawWaveform() {
    if (!PitchDetector.analyser) return;
    const bufferLength = PitchDetector.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    PitchDetector.analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = 'rgba(10, 11, 20, 0.2)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2; ctx.strokeStyle = '#00e5ff'; ctx.beginPath();

    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0; const y = v * canvas.height / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2); ctx.stroke();
}

// --- Transformación (Offline Processing) ---

function openTransformModal() {
    if (transformModal) transformModal.classList.remove('hidden');
}

window.selectTransformInstrument = async function (instName) {
    if (!pendingVoiceBlob) return;

    // UI Feedback en modal
    const grid = document.querySelector('.instrument-grid');
    const msg = document.querySelector('.processing-msg');
    if (grid) grid.style.display = 'none';
    if (msg) msg.classList.remove('hidden');

    try {
        const instrumentSound = await processAudioToInstrument(pendingVoiceBlob, instName);

        const url = URL.createObjectURL(instrumentSound);
        addTrack(url, instrumentSound, instName); // Añadir al playlist

        transformModal.classList.add('hidden');

        // Reset Modal UI
        setTimeout(() => {
            if (grid) grid.style.display = 'grid';
            if (msg) msg.classList.add('hidden');
        }, 500);

    } catch (e) {
        console.error(e);
        alert("Error procesando audio: " + e.message);
        transformModal.classList.add('hidden');
    }
};

async function processAudioToInstrument(voiceBlob, instName) {
    return new Promise(async (resolve, reject) => {
        try {
            // Decodificar la voz grabada
            const arrayBuffer = await voiceBlob.arrayBuffer();
            // Necesitamos asegurarnos de que decodeAudioData use un contexto válido
            if (audioContext.state === 'suspended') await audioContext.resume();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Configurar Procesamiento Offline
            const duration = audioBuffer.duration;
            const synth = instruments[instName];

            // Desconectar momentáneamente de speakers y mandar a grabadora interna
            const internalRecorder = new Tone.Recorder();
            synth.disconnect();
            synth.connect(internalRecorder);

            // Simular reproducción acelerada o tiempo real en memoria
            // Para mantenerlo simple y fiable, lo hacemos en tiempo real "silencioso"
            // (El usuario ve un spinner)

            const offlineSource = audioContext.createBufferSource();
            offlineSource.buffer = audioBuffer;

            // Analizador dedicado para offline
            const offlineAnalyser = audioContext.createAnalyser();
            offlineAnalyser.fftSize = 2048;
            offlineSource.connect(offlineAnalyser);

            // Preparar PitchDetector temporal manual (no modificamos el global)
            const dataArray = new Float32Array(2048);

            internalRecorder.start();
            offlineSource.start();

            const processStarTime = audioContext.currentTime;
            let processing = true;

            // Bucle de procesamiento
            const processMsg = document.querySelector('.processing-msg');

            function processStep() {
                if (!processing) return;

                const now = audioContext.currentTime;
                if (now - processStarTime > duration + 0.5) { // +0.5s tail
                    finish();
                    return;
                }

                // Actualizar progreso visual
                if (processMsg) {
                    const pct = Math.min(100, ((now - processStarTime) / duration) * 100).toFixed(0);
                    processMsg.innerHTML = `Procesando... ${pct}% <span class="spinner">⏳</span>`;
                }

                // Detectar Pitch
                offlineAnalyser.getFloatTimeDomainData(dataArray);
                const freq = PitchDetector.autoCorrelate(dataArray, audioContext.sampleRate);

                if (freq && freq > 65 && freq < 2000) {
                    synth.triggerAttackRelease(freq, 0.05); // Notas cortas
                }

                requestAnimationFrame(processStep);
            }

            processStep();

            async function finish() {
                processing = false;
                const resultBlob = await internalRecorder.stop();

                // Reconectar Synth a Speakers para el futuro
                synth.disconnect();
                synth.connect(Tone.Destination);

                // Convertir a MP3
                const mp3 = await convertBlobToMp3(resultBlob);
                resolve(mp3);
            }

        } catch (e) {
            reject(e);
        }
    });
}

// --- Gestión de Pistas ---

function addTrack(url, blob, instName) {
    const trackId = trackCounter++;
    const player = new Tone.Player(url).toDestination();

    // Crear objeto track
    const track = { id: trackId, player: player, blob: blob, name: `Pista ${trackId} (${instName})` };
    tracks.push(track);

    // Render UI
    renderTrackUI(track);
    playAllBtn.style.display = 'inline-flex';
    document.querySelector('.status-text').innerText = "¡Transformación Completa!";
}

function renderTrackUI(track) {
    const container = document.getElementById('tracks-container');
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'track-item';
    div.id = `track-${track.id}`;
    div.innerHTML = `
        <div class="track-info">
            <span class="icon">🎵</span>
            <span class="track-name">${track.name}</span>
        </div>
        <div class="track-controls">
            <input type="range" min="-20" max="6" value="0" class="track-volume" data-id="${track.id}">
            <button class="icon-btn play-single" data-id="${track.id}">▶</button>
            <button class="icon-btn" onclick="downloadTrack(${track.id})">⬇</button>
            <button class="icon-btn" onclick="deleteTrack(${track.id})">❌</button>
        </div>
    `;
    container.appendChild(div);

    // Eventos locales
    div.querySelector('.track-volume').addEventListener('input', e => track.player.volume.value = e.target.value);
    const btn = div.querySelector('.play-single');

    btn.addEventListener('click', () => {
        if (track.player.state === 'started') {
            track.player.stop();
            btn.innerText = "▶";
        } else {
            track.player.start();
            btn.innerText = "⏸";
            track.player.onstop = () => btn.innerText = "▶";
        }
    });
}

function togglePlayAll() {
    // Simple play all logic
    const isPlaying = tracks.some(t => t.player.state === 'started');
    if (isPlaying) {
        tracks.forEach(t => t.player.stop());
        playAllBtn.innerHTML = `<span class="btn-content">▶ Reproducir Todo</span>`;
    } else {
        const now = Tone.now() + 0.1;
        tracks.forEach(t => t.player.start(now));
        playAllBtn.innerHTML = `<span class="btn-content">⏸ Pausar</span>`;
    }
}

// --- Utils & Premium ---

window.deleteTrack = function (id) {
    const idx = tracks.findIndex(t => t.id === id);
    if (idx > -1) {
        tracks[idx].player.dispose();
        tracks.splice(idx, 1);
        document.getElementById(`track-${id}`).remove();
    }
    if (tracks.length === 0) {
        if (tracksContainer) tracksContainer.innerHTML = '<div class="empty-state">No hay pistas grabadas aún</div>';
        playAllBtn.style.display = 'none';
        trackCounter = 1;
    }
}

window.downloadTrack = function (id) {
    if (!isPremium) {
        document.getElementById('premium-modal').classList.remove('hidden');
        return;
    }
    const t = tracks.find(x => x.id === id);
    if (t) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(t.blob);
        a.download = `${t.name}.mp3`;
        a.click();
    }
}

// MP3 Encode
async function convertBlobToMp3(blob) {
    const ab = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(ab);

    const channels = 1;
    const sampleRate = audioBuffer.sampleRate;
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
    const samples = audioBuffer.getChannelData(0);
    const sampleBlockSize = 1152;
    const mp3Data = [];
    const samplesInt16 = new Int16Array(samples.length);

    for (let i = 0; i < samples.length; i++) {
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
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
    return new Blob(mp3Data, { type: 'audio/mp3' });
}

// Premium Init
function initPremium() {
    const savedStatus = localStorage.getItem(STORAGE_KEY);
    if (savedStatus) {
        const data = JSON.parse(savedStatus);
        if (new Date().getTime() - data.timestamp < 30 * 24 * 3600 * 1000) enablePremiumMode();
    }
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('pago') === 'aprobado') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, timestamp: new Date().getTime() }));
        enablePremiumMode();
        // Mostrar éxito
        const m = document.getElementById('premium-modal');
        if (m) {
            m.classList.remove('hidden');
            // ... (Simple success msg update could go here)
        }
    }
    const actBtn = document.getElementById('activate-btn');
    if (actBtn) actBtn.addEventListener('click', () => {
        if (document.getElementById('activation-code').value.trim() === PREMIUM_CODE) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, timestamp: new Date().getTime() }));
            enablePremiumMode();
            alert("¡Premium Activado!");
            document.getElementById('premium-modal').classList.add('hidden');
        }
    });

    const triggerInfo = document.getElementById('premium-trigger');
    if (triggerInfo) triggerInfo.addEventListener('click', () => document.getElementById('premium-modal').classList.remove('hidden'));

    const closeM = document.querySelector('.modal-close');
    if (closeM) closeM.addEventListener('click', () => document.getElementById('premium-modal').classList.add('hidden'));
}

function enablePremiumMode() {
    isPremium = true;
    const btn = document.getElementById('premium-trigger');
    if (btn) { btn.innerText = "⚡ PRO"; btn.disabled = true; }
}

// Arrancar
initPremium();
