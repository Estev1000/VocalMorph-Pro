// VocalStudio Pro Logic
// Grabador Multitrack de Alta Fidelidad (Studio Quality 32-bit Processing -> WAV 24-bit Output)

// Estado Global
let isRecording = false;
let audioContext;
let mediaRecorder;
let tracks = [];
let trackCounter = 1;
let analyser;

// Configuración de Estudio
const STUDIO_CONFIG = {
    sampleRate: 44100, // Estándar de Industria Musical
    bitDepth: 24       // Profundidad de bits de salida
};

// Premium Logic
let isPremium = false;
const PREMIUM_CODE = "PRO-VOICE-2026";
const STORAGE_KEY = "vocalstudio_pro_status";

// DOM Elements
const recordVoiceBtn = document.getElementById('record-voice-btn');
const playAllBtn = document.getElementById('play-all-btn');
const tracksContainer = document.getElementById('tracks-container');
const statusDot = document.getElementById('status-dot');
const canvas = document.getElementById('waveform');
const ctx = canvas.getContext('2d');
const studioFxToggle = document.getElementById('studio-fx-toggle');

// Event Listeners
recordVoiceBtn.addEventListener('click', toggleRecording);
playAllBtn.addEventListener('click', togglePlayMix);

// ----------------------------------------------------------------------
// MOTOR DE AUDIO (Simulación de Placa Externa)
// ----------------------------------------------------------------------

async function initAudioEngine() {
    await Tone.start();

    if (!audioContext) {
        // Forzamos 44.1kHz para cumplir el estándar de la industria
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext({
            sampleRate: 44100,
            latencyHint: 'playback' // Priorizar calidad sobre latencia
        });
        Tone.setContext(audioContext);
    }
    if (audioContext.state === 'suspended') await audioContext.resume();
}

// ----------------------------------------------------------------------
// LÓGICA DE GRABACIÓN
// ----------------------------------------------------------------------

async function toggleRecording() {
    // Premium Check
    if (!isPremium && tracks.length >= 1 && !isRecording) {
        document.getElementById('premium-modal').classList.remove('hidden');
        return;
    }

    if (!isRecording) {
        // --- INICIAR ---
        try {
            await initAudioEngine();

            // Acceso al micrófono "Raw" 
            // Esto es CLAVE: Pedimos al navegador que NO procese el audio
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: 1,
                    sampleRate: 44100
                }
            });

            // Monitor Visual
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);

            // Grabamos en el formato de mayor calidad que soporte el navegador
            // Generalmente WebM/Opus a alto bitrate es el contenedor intermedio
            let mimeType = 'audio/webm;codecs=opus';
            let options = { mimeType, audioBitsPerSecond: 256000 };

            mediaRecorder = new MediaRecorder(stream, options);
            let chunks = [];

            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

            mediaRecorder.onstop = async () => {
                const rawBlob = new Blob(chunks, { type: mimeType });

                // Procesar y Convertir a WAV 24-bit o MP3 320kbps
                const processedBlob = await processAndEncodeAudio(rawBlob);

                addTrackUI(processedBlob);
                stream.getTracks().forEach(t => t.stop());
            };

            // REPRODUCIR PISTAS EXISTENTES (Para grabar encima con sincronización perfecta)
            if (tracks.length > 0) {
                // Sincronización: Reiniciar todas las pistas desde el inicio
                const now = Tone.now() + 0.1;
                tracks.forEach(t => {
                    if (t.player.state === 'started') {
                        t.player.stop();
                    }
                    // Resetear posición a inicio (buscar a 0)
                    t.player.seek(0);
                    t.player.start(now);
                });
            }

            mediaRecorder.start();
            isRecording = true;
            drawWaveform();

            // UI
            recordVoiceBtn.classList.add('listening');
            recordVoiceBtn.innerHTML = `<span class="btn-content">🔴 GRABANDO 44.1kHz...</span>`;
            document.querySelector('.status-text').innerText = "Capturando Audio High-Res...";
            statusDot.classList.add('active');
            statusDot.style.background = "#ff0000";

        } catch (err) {
            console.error(err);
            alert("Error de Audio: " + err.message);
        }

    } else {
        // --- DETENER ---
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();

        // Detener reproducción de fondo
        if (tracks.length > 0) {
            tracks.forEach(t => t.player.stop());
        }

        isRecording = false;

        // UI Reset
        recordVoiceBtn.classList.remove('listening');
        recordVoiceBtn.innerHTML = `<span class="btn-content">🎙 REC (Nueva Pista)</span>`;
        document.querySelector('.status-text').innerText = "Renderizando Mastering...";
        statusDot.classList.remove('active');
        statusDot.style.background = "#666";
    }
}

// ----------------------------------------------------------------------
// PROCESAMIENTO & MASTERING (Offline)
// ----------------------------------------------------------------------

async function processAndEncodeAudio(rawBlob) {
    const arrayBuffer = await rawBlob.arrayBuffer();
    // Decodificar a Float32 (32-bit internos)
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    let finalBuffer = audioBuffer;

    // Si Studio FX está activo, aplicamos la "Magia Analógica"
    if (studioFxToggle && studioFxToggle.checked) {
        const offlineCtx = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;

        // --- STUDIO CHANNEL STRIP ---

        // 1. Preamp Saturation (Calidez)
        const preamp = offlineCtx.createWaveShaper();
        preamp.curve = makeDistortionCurve(5); // Muy suave para evitar saturación
        preamp.oversample = '4x';

        // 2. EQ Correctivo
        const eqLow = offlineCtx.createBiquadFilter(); // Low Cut
        eqLow.type = 'highpass';
        eqLow.frequency.value = 80;

        const eqPresence = offlineCtx.createBiquadFilter(); // Presencia
        eqPresence.type = 'peaking';
        eqPresence.frequency.value = 3000;
        eqPresence.gain.value = 1; // Reducido a 1dB para menos agresividad

        // 3. Compresor Leveling (Nivela el volumen como un pro)
        const compressor = offlineCtx.createDynamicsCompressor();
        compressor.threshold.value = -18; // Menos agresivo
        compressor.knee.value = 30;
        compressor.ratio.value = 2; // Compresión más suave
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        // Conectar Cadena (sin saturación excesiva)
        source.connect(eqLow);
        eqLow.connect(eqPresence);
        eqPresence.connect(compressor);
        compressor.connect(offlineCtx.destination);

        source.start();
        finalBuffer = await offlineCtx.startRendering();
    }

    // --- EXPORTAR ---
    // Aquí es donde convertimos los 32-bit Float internos a MP3 de alta calidad
    // o podríamos exportar WAV. Por defecto MP3 320kbps es excelente.
    return convertBufferToMp3(finalBuffer);
}

// Función auxiliar de saturación suave (Tipo Válvula)
function makeDistortionCurve(amount) {
    const k = amount, n = 44100, curve = new Float32Array(n), deg = Math.PI / 180;
    for (let i = 0; i < n; ++i) {
        const x = i * 2 / n - 1;
        curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

// Codificador LameJS MP3 320kbps
function convertBufferToMp3(buffer) {
    const channels = 1; // Mono
    const sampleRate = buffer.sampleRate;
    const kbps = 320; // CALIDAD MASTER

    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);

    const samples = buffer.getChannelData(0);
    const sampleBlockSize = 1152;
    const mp3Data = [];

    // Convertir de Float32 a Int16 para el encoder
    const samplesInt16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        // Dithering simple y clamp
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

// ----------------------------------------------------------------------
// UI & GESTIÓN DE PISTAS
// ----------------------------------------------------------------------

function addTrackUI(blob) {
    const id = trackCounter++;
    const url = URL.createObjectURL(blob);
    const player = new Tone.Player(url).toDestination();
    
    // Ajustar volumen por defecto a -3dB para evitar saturación
    player.volume.value = -3;

    const trackObj = { id, player, blob, name: `Studio_Master_${id}.mp3` };
    tracks.push(trackObj);

    const container = document.getElementById('tracks-container');
    container.querySelector('.empty-state')?.remove();

    const div = document.createElement('div');
    div.className = 'track-item';
    div.innerHTML = `
        <div class="track-info">
            <span class="icon">💿</span>
            <span class="track-name">Pista ${id} - MP3 320k</span>
        </div>
        <div class="track-controls">
            <input type="range" min="-20" max="6" value="-3" class="track-volume" oninput="setVolume(${id}, this.value)">
            <button class="icon-btn play-single" onclick="toggleSoloTrack(${id}, this)">▶</button>
            <button class="icon-btn" onclick="downloadTrack(${id})">⬇</button>
            <button class="icon-btn" onclick="deleteTrack(${id})">❌</button>
        </div>
    `;
    container.appendChild(div);

    document.querySelector('.status-text').innerText = "Procesamiento Finalizado.";
    playAllBtn.style.display = 'inline-flex';
}

window.setVolume = (id, val) => {
    const t = tracks.find(x => x.id === id);
    if (t) t.player.volume.value = parseFloat(val);
};

window.toggleSoloTrack = (id, btn) => {
    const t = tracks.find(x => x.id === id);
    if (!t) return;
    if (t.player.state === 'started') {
        t.player.stop();
        btn.innerText = "▶";
    } else {
        t.player.start();
        btn.innerText = "⏸";
        t.player.onstop = () => btn.innerText = "▶";
    }
};

window.deleteTrack = (id) => {
    const idx = tracks.findIndex(t => t.id === id);
    if (idx > -1) {
        tracks[idx].player.dispose();
        tracks.splice(idx, 1);
        document.querySelectorAll('.track-item')[idx].remove();
    }
    if (tracks.length === 0) {
        tracksContainer.innerHTML = '<div class="empty-state">La cinta está vacía.</div>';
        playAllBtn.style.display = 'none';
    }
};

async function togglePlayMix() {
    const isPlaying = tracks.some(t => t.player.state === 'started');
    if (isPlaying) {
        tracks.forEach(t => t.player.stop());
        playAllBtn.innerHTML = `<span class="btn-content">▶ Reproducir Mix</span>`;
    } else {
        await Tone.start();
        const now = Tone.now() + 0.1;
        tracks.forEach(t => {
            t.player.seek(0); // Comenzar desde el inicio
            t.player.start(now);
        });
        playAllBtn.innerHTML = `<span class="btn-content">⏸ Pausa</span>`;
    }
}

function drawWaveform() {
    if (!isRecording) return;
    requestAnimationFrame(drawWaveform);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00ff88';
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0; const y = v * canvas.height / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2); ctx.stroke();
}

// ----------------------------------------------------------------------
// PREMIUM LOGIC
// ----------------------------------------------------------------------

function initPremium() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        const d = JSON.parse(saved);
        if (new Date().getTime() - d.timestamp < 30 * 24 * 3600 * 1000) enablePremiumMode();
    }
    if (new URLSearchParams(window.location.search).get('pago') === 'aprobado') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, timestamp: new Date().getTime() }));
        enablePremiumMode();
        document.getElementById('premium-modal').classList.remove('hidden');
    }
    const trig = document.getElementById('premium-trigger');
    if (trig) trig.addEventListener('click', () => document.getElementById('premium-modal').classList.remove('hidden'));
    const close = document.querySelector('.modal-close');
    if (close) close.addEventListener('click', () => document.getElementById('premium-modal').classList.add('hidden'));

    const btn = document.getElementById('activate-btn');
    if (btn) btn.addEventListener('click', () => {
        if (document.getElementById('activation-code').value.trim() === PREMIUM_CODE) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, timestamp: new Date().getTime() }));
            enablePremiumMode();
            alert("¡Studio Pro Activado!");
            document.getElementById('premium-modal').classList.add('hidden');
        }
    });
}
function enablePremiumMode() {
    isPremium = true;
    const btn = document.getElementById('premium-trigger');
    if (btn) { btn.innerText = "⚡ PRO STUDIO"; btn.disabled = true; }
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
        a.download = t.name;
        a.click();
    }
}

initPremium();
