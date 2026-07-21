// =========================================================
// KONFIGURASI -- WAJIB DIISI sebelum dipakai
// =========================================================
// Tempel URL deployment Apps Script Anda di sini (yang berakhiran /exec)
var API_BASE_URL = 'https://script.google.com/macros/s/AKfycbxwngHosrjU6OhB7CjhfxIDf2Fb4Z7YgVPthNXoBcwSb37SBdXqEenpNT7RyuA5_YjE5A/exec';

// =========================================================

var tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// appState = "keranjang kerja" Mini App ini -- semua data yang dipakai
// form (item, field tambahan, dst) disimpan di sini, supaya alurnya
// gampang dilacak, bukan tersebar di banyak variabel.
var appState = {
  initData: tg.initData,
  masterBarang: [],
  fieldTambahan: [],
  items: [],
  kategoriLokasi: null
};

var jenisTerpilih = 'Bahan Baku';

// ---------------------------------------------------------
// Pemanggil API lewat JSONP (BUKAN fetch()) -- lihat catatan di Router.gs
// soal kenapa fetch() tidak bisa diandalkan untuk Apps Script + GitHub Pages.
// JSONP memuat data lewat tag <script>, kebal terhadap aturan CORS.
// ---------------------------------------------------------

var hitungJsonp = 0;

function panggilApi(action, paramsTambahan) {
  return new Promise(function (resolve, reject) {
    hitungJsonp++;
    var namaCallback = 'jsonpCallback_' + Date.now() + '_' + hitungJsonp;

    var params = Object.assign({ action: action, callback: namaCallback }, paramsTambahan || {});
    var query = new URLSearchParams(params);
    var src = API_BASE_URL + '?' + query.toString();

    var timeoutId = setTimeout(function () {
      bersihkan();
      reject(new Error('Waktu tunggu habis -- server tidak merespon.'));
    }, 15000);

    function bersihkan() {
      clearTimeout(timeoutId);
      delete window[namaCallback];
      if (scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
    }

    window[namaCallback] = function (data) {
      bersihkan();
      resolve(data);
    };

    var scriptEl = document.createElement('script');
    scriptEl.src = src;
    scriptEl.onerror = function () {
      bersihkan();
      reject(new Error('Gagal memuat data dari server (periksa koneksi internet).'));
    };
    document.body.appendChild(scriptEl);
  });
}

function apiGet(action, paramsTambahan) {
  return panggilApi(action, paramsTambahan);
}

function apiPost(action, dataTambahan) {
  // "POST" di sini sebenarnya tetap lewat GET+JSONP (lihat Router.gs) --
  // formData dikirim sebagai JSON string yang di-encode di parameter URL.
  var params = {};
  Object.keys(dataTambahan || {}).forEach(function (k) {
    var v = dataTambahan[k];
    params[k] = (typeof v === 'object') ? JSON.stringify(v) : v;
  });
  return panggilApi(action, params);
}

// ---------------------------------------------------------
// Inisialisasi
// ---------------------------------------------------------

function gagalMuat(err) {
  document.getElementById('layarLoading').innerHTML = '<p>Gagal memuat: ' + err.message + '</p>';
}

function tampilkanDiagnostik(pesanUtama) {
  var info = {
    pesan: pesanUtama,
    adaObjekTelegram: !!window.Telegram,
    adaWebApp: !!(window.Telegram && window.Telegram.WebApp),
    platform: tg.platform || '(kosong)',
    versionApp: tg.version || '(kosong)',
    panjangInitData: (tg.initData || '').length,
    initDataUnsafeAdaIsi: tg.initDataUnsafe && Object.keys(tg.initDataUnsafe).length > 0,
    adaDiDalamIframe: window.self !== window.top,
    urlSaatIni: window.location.href,
    panjangHashUrl: (window.location.hash || '').length,
    apiBaseUrlTerpakai: API_BASE_URL
  };
  document.getElementById('layarLoading').innerHTML =
    '<p style="font-weight:600; margin-bottom:10px;">' + pesanUtama + '</p>' +
    '<pre style="text-align:left; font-size:11px; white-space:pre-wrap; background:var(--bg-secondary); padding:10px; border-radius:8px;">' +
    JSON.stringify(info, null, 2) + '</pre>' +
    '<p style="margin-top:10px;">Salin teks di atas dan kirim ke pengembang.</p>';
}

function mulai() {
  if (API_BASE_URL.indexOf('TEMPEL_URL') !== -1) {
    document.getElementById('layarLoading').innerHTML =
      '<p>API_BASE_URL belum diisi di app.js. Buka file app.js, isi dengan URL deployment Apps Script Anda.</p>';
    return;
  }

  apiGet('getInfoUser', { initData: appState.initData })
    .then(function (hasil) {
      if (!hasil.sukses) {
        tampilkanDiagnostik(hasil.pesan);
        return;
      }
      appState.kategoriLokasi = hasil.kategoriLokasi;
      document.getElementById('infoUser').textContent = hasil.nama + ' · ' + hasil.role;

      return apiGet('getMasterBarang').then(function (barang) {
        appState.masterBarang = barang;
        return apiGet('getFieldTambahan', { initData: appState.initData, namaMenuBot: 'Pengajuan_Bahan_Baku' });
      }).then(function (field) {
        appState.fieldTambahan = field;
        renderFieldTambahan();
        tambahItem(); // mulai dengan 1 baris item kosong
        document.getElementById('layarLoading').classList.add('hidden');
        document.getElementById('layarUtama').classList.remove('hidden');
      });
    })
    .catch(gagalMuat);
}

// ---------------------------------------------------------
// Jenis Pengajuan (toggle Bahan Baku / Budget)
// ---------------------------------------------------------

document.getElementById('toggleJenis').addEventListener('click', function (e) {
  var btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#toggleJenis button').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  jenisTerpilih = btn.dataset.jenis;
  document.getElementById('fieldRekening').style.display = jenisTerpilih === 'Budget' ? 'block' : 'none';
});

// ---------------------------------------------------------
// Field Tambahan (dinamis sesuai kategori usaha, mis. KPM)
// ---------------------------------------------------------

function renderFieldTambahan() {
  var area = document.getElementById('areaFieldTambahan');
  area.innerHTML = '';
  if (!appState.fieldTambahan || appState.fieldTambahan.length === 0) return;

  var label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = 'Informasi Tambahan';
  area.appendChild(label);

  appState.fieldTambahan.forEach(function (f) {
    var wrap = document.createElement('div');
    wrap.className = 'field';
    var inputType = f.tipeData === 'angka' ? 'number' : 'text';
    wrap.innerHTML =
      '<label>' + f.label + (f.wajib ? ' *' : '') + '</label>' +
      '<input type="' + inputType + '" data-field-tambahan="' + f.namaField + '">';
    area.appendChild(wrap);
  });
}

// ---------------------------------------------------------
// Daftar Item
// ---------------------------------------------------------

function tambahItem() {
  appState.items.push({ idBarang: '', namaBarangKustom: '', qty: 1, satuan: '', perkiraanHarga: 0 });
  renderDaftarItem();
}

function hapusItem(index) {
  appState.items.splice(index, 1);
  renderDaftarItem();
}

function renderDaftarItem() {
  var kontainer = document.getElementById('daftarItem');
  kontainer.innerHTML = '';

  appState.items.forEach(function (item, index) {
    var card = document.createElement('div');
    card.className = 'item-card';

    var opsiBarang = '<option value="">-- Barang custom --</option>' +
      appState.masterBarang.map(function (b) {
        return '<option value="' + b.idBarang + '"' + (item.idBarang === b.idBarang ? ' selected' : '') + '>' + b.namaBarang + '</option>';
      }).join('');

    card.innerHTML =
      '<div class="item-card-top"><span>Item ' + (index + 1) + '</span>' +
      '<button type="button" class="remove" data-hapus="' + index + '">Hapus</button></div>' +
      '<div class="field"><select data-idx="' + index + '" data-key="idBarang">' + opsiBarang + '</select></div>' +
      (item.idBarang === '' ? '<div class="field"><input type="text" placeholder="Nama barang" data-idx="' + index + '" data-key="namaBarangKustom" value="' + item.namaBarangKustom + '"></div>' : '') +
      '<div class="item-row">' +
      '<input type="number" min="0" placeholder="Jumlah" data-idx="' + index + '" data-key="qty" value="' + item.qty + '">' +
      '<input type="text" placeholder="Satuan" data-idx="' + index + '" data-key="satuan" value="' + item.satuan + '">' +
      '</div>' +
      '<div class="field"><input type="number" min="0" placeholder="Perkiraan harga satuan" data-idx="' + index + '" data-key="perkiraanHarga" value="' + item.perkiraanHarga + '"></div>';

    kontainer.appendChild(card);
  });

  kontainer.querySelectorAll('[data-idx]').forEach(function (el) {
    el.addEventListener('input', function () {
      var idx = parseInt(el.dataset.idx, 10);
      var key = el.dataset.key;
      var item = appState.items[idx];

      if (key === 'idBarang') {
        item.idBarang = el.value;
        var barang = appState.masterBarang.filter(function (b) { return b.idBarang === el.value; })[0];
        if (barang) {
          item.satuan = barang.satuan;
          item.perkiraanHarga = barang.hargaBarang;
          item.namaBarangKustom = '';
        }
        renderDaftarItem();
        return;
      }

      item[key] = (key === 'qty' || key === 'perkiraanHarga') ? (parseFloat(el.value) || 0) : el.value;
      hitungTotal();
    });
  });

  kontainer.querySelectorAll('[data-hapus]').forEach(function (el) {
    el.addEventListener('click', function () { hapusItem(parseInt(el.dataset.hapus, 10)); });
  });

  hitungTotal();
}

function hitungTotal() {
  var total = appState.items.reduce(function (sum, item) {
    return sum + (item.qty || 0) * (item.perkiraanHarga || 0);
  }, 0);
  document.getElementById('totalNilai').textContent = 'Rp' + total.toLocaleString('id-ID');
}

document.getElementById('btnTambahItem').addEventListener('click', tambahItem);

// ---------------------------------------------------------
// Submit
// ---------------------------------------------------------

document.getElementById('btnKirim').addEventListener('click', function () {
  var pesanStatus = document.getElementById('pesanStatus');
  pesanStatus.textContent = '';
  pesanStatus.className = 'pesan-status';

  if (appState.items.length === 0) {
    pesanStatus.textContent = 'Minimal 1 item harus diisi.';
    pesanStatus.className = 'pesan-status error';
    return;
  }

  var fieldTambahan = {};
  document.querySelectorAll('[data-field-tambahan]').forEach(function (el) {
    fieldTambahan[el.dataset.fieldTambahan] = el.value;
  });

  var formData = {
    jenisPengajuan: jenisTerpilih,
    deskripsiUmum: document.getElementById('inputDeskripsi').value,
    rekeningTujuan: document.getElementById('inputRekening').value,
    itemList: appState.items.map(function (item) {
      var barang = appState.masterBarang.filter(function (b) { return b.idBarang === item.idBarang; })[0];
      return {
        idBarang: item.idBarang,
        namaBarangDatabase: barang ? barang.namaBarang : '',
        namaBarangKustom: item.namaBarangKustom,
        qty: item.qty,
        satuan: item.satuan,
        perkiraanHarga: item.perkiraanHarga
      };
    }),
    fieldTambahan: fieldTambahan
  };

  var btn = document.getElementById('btnKirim');
  btn.disabled = true;
  btn.textContent = 'Mengirim...';

  apiPost('submitPengajuan', { initData: appState.initData, formData: formData })
    .then(function (hasil) {
      btn.disabled = false;
      btn.textContent = 'Kirim Pengajuan';
      if (!hasil.sukses) {
        pesanStatus.textContent = hasil.pesan;
        pesanStatus.className = 'pesan-status error';
        return;
      }
      document.getElementById('idPengajuanSukses').textContent = 'ID: ' + hasil.idPengajuan;
      document.getElementById('layarUtama').classList.add('hidden');
      document.getElementById('layarSukses').classList.remove('hidden');
    })
    .catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Kirim Pengajuan';
      pesanStatus.textContent = 'Terjadi kesalahan: ' + err.message;
      pesanStatus.className = 'pesan-status error';
    });
});

mulai();
