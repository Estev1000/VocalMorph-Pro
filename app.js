// VocalMorph Pro Logic (Offline Workflow)

// Estado Global
let isRecording = false;
let currentInstrument = 'violin'; // Default para preview
let audioContext;
let stream;
let recorder;
let voiceRecorder; // Grabador dedicado para voz limpia
let tracks = [];
let trackCounter = 1;
let pendingVoiceBlob = null; // Blob de voz esperando transformación

// Configuración de Instrumentos
const instruments = {
    violin: new Tone.FMSynth({
        harmonicity: 3.01, modulationIndex: 14, oscillator: { type: "pulse" },
        envelope: { attack: 0.2, decay: 0.1, sustain: 0.9, release: 1 },
        modulation: { type: "square" }, modulationEnvelope: { attack: 0.1, decay: 0.5, sustain: 0.5, release: 0.5 }
    }),
    cello: new Tone.MonoSynth({
        frequency: "C2", oscillator: { type: "sawtooth" }, filter: { Q: 2, type: "lowpass", rollover: -12 },
        envelope: { attack: 0.3, decay: 0.3, sustain: 0.8, release: 1 },
        filterEnvelope: { attack: 0.2, decay: 0.5, sustain: 0.7, release: 2, baseFrequency: 150, octaves: 3 }
    }),
    synth: new Tone.Synth({
        oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.4 }
    })
};

// Premium Logic
let isPremium = false;
const PREMIUM_CODE = "PRO-VOICE-2026";
const STORAGE_KEY = "vocalmorph_pro_status";

// DOM Elements
const recordVoiceBtn = document.getElementById('record-voice-btn');
const playAllBtn = document.getElementById('play-all-btn');
const tracksContainer = document.getElementById('tracks-container');
const transformModal = document.getElementById('transform-modal');
const transformCloseBtn = document.querySelector('.modal-close-transform');

// --- Initialization ---

function initApp() {
    initPremium();

    // UI Events
    recordVoiceBtn.addEventListener('click', toggleVoiceRecording);
    playAllBtn.addEventListener('click', togglePlayAll);
    transformCloseBtn.addEventListener('click', () => transformModal.classList.add('hidden'));

    // Setup Audio Context on first interaction
    document.addEventListener('click', async () => {
        if (!audioContext) {
            await Tone.start();
            audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Connect instruments to master
            const master = Tone.Destination;
            Object.values(instruments).forEach(i => i.connect(master));
        }
    }, { once: true });
}

// --- Voice Recording Logic ---

async function toggleVoiceRecording() {
    // Premium Check (Limit 1 track for free users)
    if (!isPremium && tracks.length >= 1 && !isRecording) {
        document.getElementById('premium-modal').classList.remove('hidden');
        return;
    }

    if (!isRecording) {
        // Start Recording
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Visualizer connection
            PitchDetector.init(audioContext, stream);
            drawWaveform(); // Start loop

            // Use MediaRecorder for raw voice
            voiceRecorder = new MediaRecorder(stream);
            let chunks = [];
            voiceRecorder.ondataavailable = e => chunks.push(e.data);
            voiceRecorder.onstop = async () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                pendingVoiceBlob = blob;
                openTransformModal(); // Immediately ask what to do with this voice
            };

            voiceRecorder.start();
            isRecording = true;

            // UI Update
            recordVoiceBtn.classList.add('listening'); // Pulse effect
            recordVoiceBtn.innerHTML = `<span class="btn-content">⏹ Detener Grabación</span>`;
            document.querySelector('.status-text').innerText = "Grabando Voz Clean...";
            document.getElementById('status-dot').classList.add('active');

        } catch (err) {
            console.error(err);
            alert("Error: No se pudo acceder al micrófono.");
        }
    } else {
        // Stop Recording
        voiceRecorder.stop();
        stream.getTracks().forEach(t => t.stop());
        isRecording = false;

        // UI Update
        recordVoiceBtn.classList.remove('listening');
        recordVoiceBtn.innerHTML = `<span class="btn-content">🎙 Grabar Voz</span>`;
        document.querySelector('.status-text').innerText = "Procesamiento Pendiente...";
        document.getElementById('status-dot').classList.remove('active');
    }
}

function openTransformModal() {
    transformModal.classList.remove('hidden');
}

// --- Transform Logic ("Offline" Processing) ---

window.selectTransformInstrument = async function (instName) {
    if (!pendingVoiceBlob) return;

    // UI feedback
    document.querySelector('.instrument-grid').style.display = 'none';
    document.querySelector('.processing-msg').classList.remove('hidden');

    try {
        const instrumentSound = await processAudioToInstrument(pendingVoiceBlob, instName);

        // Create Track
        const url = URL.createObjectURL(instrumentSound);
        addTrack(url, instrumentSound, instName);

        // Close Modal & Reset
        transformModal.classList.add('hidden');

        // Restore Modal UI for next time
        setTimeout(() => {
            document.querySelector('.instrument-grid').style.display = 'grid';
            document.querySelector('.processing-msg').classList.add('hidden');
        }, 500);

    } catch (e) {
        console.error(e);
        alert("Error en la transformación.");
        transformModal.classList.add('hidden');
    }
};

async function processAudioToInstrument(voiceBlob, instName) {
    return new Promise(async (resolve, reject) => {
        // 1. Decode Voice Audio
        const arrayBuffer = await voiceBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // 2. Setup Tone.js Offline context? No, use Realtime fast or normal. 
        // We will use realtime playback but "muted" to speakers, recording the synth output.
        // NOTE: Faster acceleration (playbackRate) might break pitch detection accuracy.
        // We stick to 1x speed for quality.

        const duration = audioBuffer.duration;
        const synth = instruments[instName];

        // Temporary Recorder for Synth Output
        const destRecorder = new Tone.Recorder();
        synth.disconnect(); // Disconnect from master speakers
        synth.connect(destRecorder); // Connect to recorder

        // Player for Voice (Source)
        // We create a buffer source node manually to feed PitchDetector
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;

        // Connect Source -> PitchDetector
        PitchDetector.updateSource(source);

        // Start Analysis Loop
        destRecorder.start();
        source.start();

        const startTime = audioContext.currentTime;
        let processing = true;

        // Analysis Loop
        function processLoop() {
            if (!processing) return;

            const now = audioContext.currentTime;
            if (now - startTime > duration) {
                // Done
                finishProcessing();
                return;
            }

            // Detect Pitch
            const freq = PitchDetector.getPitch();
            if (freq && freq > 65 && freq < 2000) {
                // Trigger Synth
                // We use setNote/frequency ramp for continuous tracking
                // If Envelope is attack/release style, we need to manage triggers.
                // For simplicity in this "morph" mode, we hold note if freq exists.

                // synth.triggerAttack(freq); // This retriggers attack too much
                // Better: ramp frequency if active, trigger if new

                synth.triggerAttackRelease(freq, 0.1); // Granular approach 
            }

            requestAnimationFrame(processLoop);
        }

        processLoop();

        async function finishProcessing() {
            processing = false;

            // Allow tail release
            setTimeout(async () => {
                const recording = await destRecorder.stop();

                // Reconnect synth to speakers for playback
                synth.disconnect();
                synth.connect(Tone.Destination);

                // Convert to MP3
                const mp3 = await convertBlobToMp3(recording);
                resolve(mp3);

            }, 500); // 500ms tail
        }
    });
}


// --- Track Management ---

function addTrack(url, blob, instName) {
    const trackId = trackCounter++;
    const player = new Tone.Player(url).toDestination();

    const track = { id: trackId, player: player, blob: blob, name: `Pista ${trackId} (${instName})` };
    tracks.push(track);
    renderTrackUI(track);

    playAllBtn.style.display = 'inline-flex';
    document.querySelector('.status-text').innerText = "Listo para grabar";
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
            <input type="range" min="-20" max="6" value="0" class="track-volume" data-id="${track.id}">
            <button class="icon-btn play-single" data-id="${track.id}">▶</button>
            <button class="icon-btn" onclick="downloadTrack(${track.id})">⬇</button>
            <button class="icon-btn" onclick="deleteTrack(${track.id})">❌</button>
        </div>
    `;
    container.appendChild(div);

    // Bind Events
    div.querySelector('.track-volume').addEventListener('input', e => track.player.volume.value = parseFloat(e.target.value));
    const playBtn = div.querySelector('.play-single');
    playBtn.addEventListener('click', () => {
        if (track.player.state === "started") { track.player.stop(); playBtn.innerText = "▶"; }
        else { track.player.start(); playBtn.innerText = "⏸"; track.player.onstop = () => { playBtn.innerText = "▶" }; }
    });
}

window.deleteTrack = function (id) {
    const idx = tracks.findIndex(t => t.id === id);
    if (idx > -1) {
        tracks[idx].player.dispose();
        tracks.splice(idx, 1);
        document.getElementById(`track-${id}`).remove();
    }
};

window.downloadTrack = function (id) {
    if (!isPremium) { document.getElementById('premium-modal').classList.remove('hidden'); return; }
    const t = tracks.find(x => x.id === id);
    if (t) {
        const a = document.createElement("a");
        a.download = `${t.name}.mp3`;
        a.href = URL.createObjectURL(t.blob);
        a.click();
    }
};

function togglePlayAll() {
    const isPlaying = tracks.some(t => t.player.state === 'started');
    if (isPlaying) {
        tracks.forEach(t => { t.player.stop(); });
        playAllBtn.innerHTML = `<span class="btn-content">▶ Reproducir Todo</span>`;
    } else {
        const now = Tone.now() + 0.1;
        tracks.forEach(t => t.player.start(now));
        playAllBtn.innerHTML = `<span class="btn-content">⏸ Pausa</span>`;
    }
}

// --- MP3 Utils ---
async function convertBlobToMp3(blob) {
    // Reusando función existente o definiendo nueva
    // (Se incluye simplificada aquí para asegurar que funcione con el nuevo código)
    const ab = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(ab);
    return encodeMp3(audioBuffer);
}
function encodeMp3(buffer) {
    const channels = 1;
    const sampleRate = buffer.sampleRate;
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
    const samples = buffer.getChannelData(0);
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

// --- Visualizer ---
function drawWaveform() {
    if (!PitchDetector.analyser) return;
    const canvas = document.getElementById('waveform');
    const ctx = canvas.getContext('2d');
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
    requestAnimationFrame(drawWaveform);
}

// --- Premium Init Logic (Localstorage etc) ---
function initPremium() {
    const savedStatus = localStorage.getItem(STORAGE_KEY);
    if (savedStatus) {
        const data = JSON.parse(savedStatus);
        if (new Date().getTime() - data.timestamp < 30 * 24 * 3600 * 1000) enablePremiumMode();
    }

    // Auto-activación por URL (Mercado Pago Return)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('pago') === 'aprobado') {
        // Activar Directamente
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, timestamp: new Date().getTime() }));
        enablePremiumMode();

        // Mostrar Modal de Éxito
        const modal = document.getElementById('premium-modal');
        modal.classList.remove('hidden');

        // Limpiar contenido del modal para mostrar solo éxito
        const content = modal.querySelector('.modal-content');
        content.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <div style="font-size: 4rem; margin-bottom: 1rem;">🎉</div>
                <h2 style="color: #00e676; margin-bottom: 0.5rem;">¡Suscripción Activada!</h2>
                <p style="color: #ccc; margin-bottom: 2rem;">Gracias por apoyar VocalMorph Pro.</p>
                <button id="close-success-btn" style="background: #00e676; color: #000; border: none; padding: 1rem 2rem; border-radius: 50px; font-weight: bold; cursor: pointer; font-size: 1.1rem;">Comenzar a Crear</button>
            </div>
        `;

        document.getElementById('close-success-btn').addEventListener('click', () => {
            modal.classList.add('hidden');
            // Limpiar URL para que no vuelva a saltar al recargar
            window.history.replaceState({}, document.title, "/VocalMorph-Pro/");
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
        alert("Activado!");
        document.getElementById('premium-modal').classList.add('hidden');
    }
}
function enablePremiumMode() {
    isPremium = true;
    const btn = document.getElementById('premium-trigger');
    btn.innerText = "⚡ PRO"; btn.disabled = true;
}

// Start
initApp();
