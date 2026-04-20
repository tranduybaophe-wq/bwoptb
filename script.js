// ===== Elements =====
const screens = {
  home: document.getElementById('screen-home'),
  capture: document.getElementById('screen-capture'),
  downloading: document.getElementById('screen-downloading'),
  done: document.getElementById('screen-done'),
};

const btnStart = document.getElementById('btnStart');
const btnCapture = document.getElementById('btnCapture');
const btnDownload = document.getElementById('btnDownload');
const btnRetake = document.getElementById('btnRetake');
const btnPrevTpl = document.getElementById('btnPrevTpl');
const btnNextTpl = document.getElementById('btnNextTpl');
const btnHome = document.getElementById('btnHome');


const video = document.getElementById('video');
const countdownEl = document.getElementById('countdown');

const stripPreview = document.getElementById('stripPreview');
const stripOut = document.getElementById('stripOut');
const stripFinal = document.getElementById('stripFinal');
const printSound = document.getElementById('printSound');
const shutterSound = document.getElementById('shutterSound');


const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ===== Config (from your brief) =====
const TEMPLATES = [
  'assets/template1.PNG',
  'assets/template2.PNG',
  'assets/template3.PNG',
];

let templateIndex = 0;

// Final strip canvas size
const STRIP_W = 300;
const STRIP_H = 900;

// Each photo slot size
const PHOTO_W = 270;
const PHOTO_H = 202.5; // keep 4:3 exact

// Slot positions
const SLOTS = [
  { x: 15, y: 199 },
  { x: 15, y: 408 },
  { x: 15, y: 617 },
];

const COUNTDOWN_SEC = 3;

// FIT MODE:
// - "cover"  => foto FULL ngepas frame (crop sedikit) [RECOMMENDED]
// - "contain" => foto tidak kepotong tapi bisa ada space kosong
const FIT_MODE = "cover";

// ===== State =====
let stream = null;
let templateImg = null;
let photos = [null, null, null]; // store ImageBitmap
let currentIndex = 0;            // 0..3 (3 = penuh)
let isBusy = false;

// ===== Utils =====
function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('hidden', key !== name);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setCaptureEnabled(enabled) {
  btnCapture.disabled = !enabled;
  btnCapture.style.opacity = enabled ? '1' : '0.55';
}

function playSound(audioEl){
  if (!audioEl) return;
  audioEl.currentTime = 0;
  audioEl.play().catch(() => {});
}


function filledCount() {
  return photos.filter(Boolean).length;
}

// Optional: bubble "retake?" pindah mengikuti foto terakhir yang sudah terisi
function updateRetakePosition(lastIdx) {
  // kamu bisa adjust angka top ini biar pas sama desain kamu
  const TOPS = [215, 425, 635];
  btnRetake.style.top = (TOPS[lastIdx] ?? TOPS[0]) + "px";
}

async function loadTemplate(){
  templateImg = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal load template'));
    img.src = TEMPLATES[templateIndex];
  });
  return templateImg;
}


async function startCamera() {
  // NOTE: must be HTTPS (GitHub Pages OK) or localhost.
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
}

function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
}

async function runCountdown(seconds = 3) {
  countdownEl.classList.remove('hidden');
  for (let s = seconds; s >= 1; s--) {
    countdownEl.textContent = String(s);
    await sleep(800);
  }
  countdownEl.classList.add('hidden');
}

async function captureFrameToBitmap() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  const temp = document.createElement('canvas');
  temp.width = vw;
  temp.height = vh;
  const tctx = temp.getContext('2d');

  // mirror to match preview
  tctx.save();
  tctx.translate(vw, 0);
  tctx.scale(-1, 1);
  tctx.drawImage(video, 0, 0, vw, vh);
  tctx.restore();

  return await createImageBitmap(temp);
}

// ===== Drawing helpers =====
function drawImageContain(ctx, img, x, y, w, h) {
  const srcW = img.width, srcH = img.height;
  const srcRatio = srcW / srcH;
  const dstRatio = w / h;

  let drawW = w, drawH = h, dx = x, dy = y;

  if (srcRatio > dstRatio) {
    drawW = w;
    drawH = w / srcRatio;
    dy = y + (h - drawH) / 2;
  } else {
    drawH = h;
    drawW = h * srcRatio;
    dx = x + (w - drawW) / 2;
  }
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

function drawImageCover(ctx, img, x, y, w, h) {
  const srcW = img.width, srcH = img.height;
  const srcRatio = srcW / srcH;
  const dstRatio = w / h;

  let drawW, drawH, dx, dy;

  if (srcRatio > dstRatio) {
    // source lebih lebar -> crop kiri kanan
    drawH = h;
    drawW = h * srcRatio;
    dx = x - (drawW - w) / 2;
    dy = y;
  } else {
    // source lebih tinggi -> crop atas bawah
    drawW = w;
    drawH = w / srcRatio;
    dx = x;
    dy = y - (drawH - h) / 2;
  }
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

function drawStripPreview() {
  canvas.width = STRIP_W;
  canvas.height = STRIP_H;
  ctx.clearRect(0, 0, STRIP_W, STRIP_H);

  // Draw photos first (behind template)
  for (let i = 0; i < 3; i++) {
    const bmp = photos[i];
    if (!bmp) continue;

    const { x, y } = SLOTS[i];

    if (FIT_MODE === "contain") {
      drawImageContain(ctx, bmp, x, y, PHOTO_W, PHOTO_H);
    } else {
      drawImageCover(ctx, bmp, x, y, PHOTO_W, PHOTO_H);
    }
  }

  // Draw template above
  if (templateImg) {
    ctx.drawImage(templateImg, 0, 0, STRIP_W, STRIP_H);
  }

  const url = canvas.toDataURL('image/png');
  stripPreview.src = url;
  return url;
}

function updateUI() {
  const filled = photos.every(Boolean);

  // Download enabled only if 3 photos are filled
  btnDownload.disabled = !filled;
  btnDownload.style.opacity = filled ? '1' : '0.55';

  // Retake button appears after at least 1 photo
  const any = photos.some(Boolean);
  btnRetake.classList.toggle('hidden', !any);

  // Capture enabled only if not fully filled and not busy
  if (filled || isBusy) {
    setCaptureEnabled(false);
  } else {
    setCaptureEnabled(true);
  }

  // Move retake bubble near last filled slot (optional)
  const count = filledCount();
  if (count > 0) updateRetakePosition(count - 1);
}

function resetSession() {
  photos = [null, null, null];
  currentIndex = 0;
  isBusy = false;

  btnRetake.classList.add('hidden');
  btnDownload.disabled = true;
  btnDownload.style.opacity = '0.55';

  setCaptureEnabled(true);

  if (templateImg) drawStripPreview();
}

// ===== Download flow =====
function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ===== Events =====
btnStart.addEventListener('click', async () => {
  showScreen('capture');

  btnPrevTpl.addEventListener('click', async () => {
  templateIndex = (templateIndex - 1 + TEMPLATES.length) % TEMPLATES.length;
  await loadTemplate();
  drawStripPreview();
});

btnNextTpl.addEventListener('click', async () => {
  templateIndex = (templateIndex + 1) % TEMPLATES.length;
  await loadTemplate();
  drawStripPreview();
});

  
  try {
    await loadTemplate();
    await startCamera();

    drawStripPreview(); // template only
    updateUI();
  } catch (err) {
    alert(
      'Gagal start camera / load template.\n' +
      'Pastikan izin kamera aktif & pakai HTTPS/localhost.\n\n' +
      err.message
    );
    showScreen('home');
  }
});

btnCapture.addEventListener('click', async () => {
  if (isBusy) return;
  if (currentIndex >= 3) return; // sudah penuh

  isBusy = true;
  updateUI(); // disable capture while busy

  try {
    await runCountdown(COUNTDOWN_SEC);

    const bmp = await captureFrameToBitmap();
    photos[currentIndex] = bmp;

    currentIndex += 1; // 0->1->2->3

    drawStripPreview();
    playSound(shutterSound);
  } catch (err) {
    console.error(err);
    alert('Gagal capture foto: ' + err.message);
  } finally {
    isBusy = false;
    updateUI();
  }
});

// RETAKE: hapus foto TERAKHIR saja (bukan reset semua)
btnRetake.addEventListener('click', () => {
  const count = filledCount();
  if (count === 0) return;

  const lastIdx = count - 1; // 0,1,2
  photos[lastIdx] = null;
  currentIndex = lastIdx;    // next capture isi slot itu lagi

  drawStripPreview();
  updateUI();
 

});

btnDownload.addEventListener('click', async () => {
  if (btnDownload.disabled) return;

  const finalUrl = drawStripPreview();

  showScreen('downloading');

  stripOut.src = finalUrl;
  stripFinal.src = finalUrl;

  stripOut.classList.remove('play');
  void stripOut.offsetWidth; // force reflow
  stripOut.classList.add('play');
playSound(printSound);
  await sleep(3100);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadDataUrl(finalUrl, `photostrip-jyo-${stamp}.png`);

  showScreen('done');
});

btnHome.addEventListener('click', () => {
  resetSession();
  stopCamera();
  showScreen('home');
});

window.addEventListener('beforeunload', () => stopCamera());

// ===== Hearts background (simple) =====
const heartsRoot = document.getElementById('hearts');
let heartsTimer = null;

function spawnHeart(){
  if (!heartsRoot) return;

  const el = document.createElement('div');
  el.className = 'heart';
  el.textContent = '❤';

  const size = 10 + Math.random() * 18;        // 10–28px
  const left = Math.random() * 100;            // 0–100vw
  const dur  = 4 + Math.random() * 4;          // 4–8s
  const drift = (Math.random() * 120 - 60);    // -60..60px
  const scale = 0.7 + Math.random() * 0.8;     // 0.7..1.5

  el.style.left = left + 'vw';
  el.style.fontSize = size + 'px';
  el.style.animationDuration = dur + 's';
  el.style.setProperty('--drift', drift + 'px');
  el.style.setProperty('--scale', scale);

  // warna random soft (pink/merah)
  const colors = ['#ff6b9a', '#ff4d6d', '#ff8fab', '#ffd1dc'];
  el.style.color = colors[Math.floor(Math.random() * colors.length)];

  heartsRoot.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function startHearts(){
  if (heartsTimer) return;
  // spawn 1 heart tiap 250ms (kamu bisa ubah lebih pelan/cepet)
  heartsTimer = setInterval(spawnHeart, 250);
}

function stopHearts(){
  if (!heartsTimer) return;
  clearInterval(heartsTimer);
  heartsTimer = null;
  if (heartsRoot) heartsRoot.innerHTML = '';
}

// nyalakan hearts dari awal
startHearts();
