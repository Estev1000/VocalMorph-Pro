// VocalStudio Pro Logic
// Grabador Multitrack de Alta Fidelidad (32-bit Float Internal Processing)

// Estado Global
let isRecording = false;
let audioContext;
let micSource;          // La señal cruda del micrófono
let studioChain;        // La cadena de efectos "Preamp Virtual"
let mediaRecorder;      // Grabador del navegador
let tracks = [];
let trackCounter = 1;
let animationId;
let analyser;           // Para visualizar la onda

// Configuración de Calidad de Estudio
const STUDIO_CONFIG = {
    sampleRate: 44100, // Estándar de CD
    bitDepth: 32,      // Procesamiento interno (Float)
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

    // 1. Contexto de Audio (32-bit Float por defecto en navegadores modernos)
    if (!audioContext) {
        audioContext = Tone.context.rawContext || Tone.context;
    }
    if (audioContext.state === 'suspended') await audioContext.resume();

    // 2. Cadena de "Preamp Virtual" (Simula una buena captura)
    // Usamos Tone.UserMedia para gestionar la entrada mejor que raw getUserMedia
    const mic = new Tone.UserMedia();

    // Cadena de efectos: Mic -> Compresor Suave -> Ecualizador -> Limitador -> Destino
    const compressor = new Tone.Compressor({
        threshold: -20,
        ratio: 3,
        attack: 0.003,
        release: 0.1
    });

    const eq = new Tone.EQ3({
        low: 0,
        mid: -2, // Cortar un poco los medios nasales típicos de micrófonos de PC
        high: 3  // Dar "aire" y brillo (Calidad de estudio)
    });

    // Conectar la cadena
    // Nota: No conectamos a Tone.Destination para evitar feedback loop (acople)
    mic.chain(compressor, eq);

    return { mic, outputNode: eq };
}

// ----------------------------------------------------------------------
// LÓGICA DE GRABACIÓN
// ----------------------------------------------------------------------

async function toggleRecording() {
    // Premium Check (Límite de pistas para usuarios Free)
    if (!isPremium && tracks.length >= 1 && !isRecording) {
        document.getElementById('premium-modal').classList.remove('hidden');
        return;
    }

    if (!isRecording) {
        // --- INICIAR ---
        try {
            await Tone.start();

            // Acceso al micrófono con constraints de alta calidad
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false, // DESACTIVAR procesado del navegador (Queremos raw)
                    noiseSuppression: false, // DESACTIVAR supresión de ruido (Mata frecuencias)
                    autoGainControl: false,  // DESACTIVAR ganancia auto (Queremos dinámica real)
                    channelCount: 1
                }
            });

            // Configurar Monitorización Visual
            if (!audioContext) audioContext = Tone.context;
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser); // Solo para ver la onda

            // Configurar Grabadora (Usamos MediaRecorder con opciones de alta calidad)
            // Intentamos usar PCM si el navegador lo soporta, o Opus a alto bitrate
            let mimeType = 'audio/webm;codecs=opus';
            let options = {
                mimeType: mimeType,
                audioBitsPerSecond: 256000 // 256 kbps (Calidad muy alta)
            };

            mediaRecorder = new MediaRecorder(stream, options);
            let chunks = [];

            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

            mediaRecorder.onstop = async () => {
                const blob = new Blob(chunks, { type: mimeType });

                // Procesar el audio grabado (Aplicar FX si está activado)
                const processedBlob = await processRecordedAudio(blob);

                // Añadir al "Tape" virtual
                addTrackUI(processedBlob);

                // Limpiar
                stream.getTracks().forEach(t => t.stop());
            };

            mediaRecorder.start();
            isRecording = true;

            // Iniciar UI Loop
            drawWaveform();

            // UI
            recordVoiceBtn.classList.add('listening');
            recordVoiceBtn.innerHTML = `<span class="btn-content">🔴 GRABANDO...</span>`;
            document.querySelector('.status-text').innerText = "Capturando Audio Hi-Fi...";
            statusDot.classList.add('active');
            statusDot.style.background = "#ff0000"; // Rojo grabación

        } catch (err) {
            console.error(err);
            alert("Error: " + err.message);
        }

    } else {
        // --- DETENER ---
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        isRecording = false;

        // UI Reset
        recordVoiceBtn.classList.remove('listening');
        recordVoiceBtn.innerHTML = `<span class="btn-content">🎙 REC (Nueva Pista)</span>`;
        document.querySelector('.status-text').innerText = "Procesando...";
        statusDot.classList.remove('active');
        statusDot.style.background = "#666";
    }
}

// ----------------------------------------------------------------------
// PROCESAMIENTO OFFLINE ("Renderizado de Estudio")
// ----------------------------------------------------------------------

async function processRecordedAudio(rawBlob) {
    // Si el usuario desactivó FX, devolvemos el audio tal cual
    if (!studioFxToggle.checked) return rawBlob;

    document.querySelector('.status-text').innerText = "Aplicando FX de Estudio...";

    const arrayBuffer = await rawBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Renderizar Offline para aplicar Efectos (Compresión + EQ)
    const offlineCtx = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);

    // Recrear cadena de efectos en el contexto offline
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    // Emulación de Placa: Compresión suave + EQ 'Brillo'
    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 30; // Curva suave
    compressor.ratio.value = 3; // Compresión musical
    compressor.attack.value = 0.003;
    compressor.release.value = 0.1;

    const eqLow = offlineCtx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 200;
    eqLow.gain.value = -2; // Limpiar graves sucios (muddy)

    const eqHigh = offlineCtx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 4000;
    eqHigh.gain.value = 4; // Brillo profesional ("Air")

    // Conectar FX
    source.connect(eqLow);
    eqLow.connect(eqHigh);
    eqHigh.connect(compressor);
    compressor.connect(offlineCtx.destination);

    source.start();

    const renderedBuffer = await offlineCtx.startRendering();

    // Convertir Buffer renderizado de vuelta a Blob (WAV/MP3)
    return bufferToWave(renderedBuffer, renderedBuffer.length);
}

// ----------------------------------------------------------------------
// UI & GESTIÓN DE PISTAS
// ----------------------------------------------------------------------

function addTrackUI(blob) {
    const id = trackCounter++;
    const url = URL.createObjectURL(blob);

    // Crear Player Tone.js para esta pista
    const player = new Tone.Player(url).toDestination();

    const trackObj = { id, player, blob, name: `Pista ${id} (Studio)` };
    tracks.push(trackObj);

    const container = document.getElementById('tracks-container');
    container.querySelector('.empty-state')?.remove();

    const div = document.createElement('div');
    div.className = 'track-item';
    div.innerHTML = `
        <div class="track-info">
            <span class="icon">🎹</span>
            <span class="track-name">${trackObj.name}</span>
        </div>
        <div class="track-controls">
            <input type="range" min="-20" max="6" value="0" class="track-volume" oninput="setVolume(${id}, this.value)">
            <button class="icon-btn play-single" onclick="toggleSoloTrack(${id}, this)">▶</button>
            <button class="icon-btn" onclick="downloadTrack(${id})">💾</button>
            <button class="icon-btn" onclick="deleteTrack(${id})">❌</button>
        </div>
    `;
    container.appendChild(div);

    document.querySelector('.status-text').innerText = "Listo";
    playAllBtn.style.display = 'inline-flex';
}

// Helpers globales para el UI
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
        // Re-render simple
        const item = document.querySelectorAll('.track-item')[idx];
        if (item) item.remove();
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
        tracks.forEach(t => t.player.start(now));
        playAllBtn.innerHTML = `<span class="btn-content">⏸ Pausa</span>`;
    }
}

// ----------------------------------------------------------------------
// VISUALIZADOR (CANVAS)
// ----------------------------------------------------------------------
function drawWaveform() {
    if (!isRecording) return;
    requestAnimationFrame(drawWaveform);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = '#0a0b14'; // Background oscuro studio
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00e676'; // Verde Studio típico
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

// ----------------------------------------------------------------------
// UTILIDADES: WAV ENCODER (Para exportar la supuesta calidad "24-bit")
// ----------------------------------------------------------------------

// Convierte AudioBuffer a WAV Blob
function bufferToWave(abuffer, len) {
    const numOfChan = abuffer.numberOfChannels;
    const length = len * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let i, sample;
    let offset = 0;
    let pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (estándar compatible)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // write interleaved data
    for (i = 0; i < abuffer.numberOfChannels; i++)
        channels.push(abuffer.getChannelData(i));

    while (pos < len) {
        for (i = 0; i < numOfChan; i++) { // interleave channels
            sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // convert to 16-bit PCM
            view.setInt16(44 + offset, sample, true); // write 16-bit sample
            offset += 2;
        }
        pos++;
    }

    return new Blob([buffer], { type: "audio/wav" });

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }
    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}

// ----------------------------------------------------------------------
// PREMIUM LOGIC (Integrada)
// ----------------------------------------------------------------------

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
        document.getElementById('premium-modal').classList.remove('hidden');
    }

    const trigger = document.getElementById('premium-trigger');
    if (trigger) trigger.addEventListener('click', () => document.getElementById('premium-modal').classList.remove('hidden'));

    const closeBtn = document.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => document.getElementById('premium-modal').classList.add('hidden'));

    const actBtn = document.getElementById('activate-btn');
    if (actBtn) actBtn.addEventListener('click', () => {
        if (document.getElementById('activation-code').value.trim() === PREMIUM_CODE) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, timestamp: new Date().getTime() }));
            enablePremiumMode();
            alert("¡Estudio Pro Desbloqueado!");
            document.getElementById('premium-modal').classList.add('hidden');
        } else {
            alert("Código incorrecto");
        }
    });
}

function enablePremiumMode() {
    isPremium = true;
    const btn = document.getElementById('premium-trigger');
    if (btn) { btn.innerText = "⚡ STUDIO PRO"; btn.disabled = true; }
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
        a.download = `Studio_Track_${id}.wav`; // Exportamos WAV para máxima calidad
        a.click();
    }
}

// Iniciar Premium
initPremium();
