// =========================================================
// KONFIGURASI -- WAJIB DIISI sebelum dipakai
// =========================================================
// Tempel URL deployment Apps Script Anda di sini (yang berakhiran /exec)
var API_BASE_URL = 'https://script.google.com/macros/s/AKfycbzwotyEi9ffB074zyzLZs010NLsdrgmy2VMWX6_E6A42Saa_jLX5wvQh_4J_dZwkGKM/exec';

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
// Pemanggil API (fetch), pengganti google.script.run
// ---------------------------------------------------------

function apiGet(action, paramsTambahan) {
  var params = new URLSearchParams(Object.assign({ action: action }, paramsTambahan || {}));
  return fetch(API_BASE_URL + '?' + params.toString())
    .then(function (res) { return res.json(); });
}

function apiPost(action, dataTambahan) {
  // PENTING: Content-Type text/plain (BUKAN application/json) supaya
  // browser tidak melakukan CORS preflight -- lihat catatan di Router.gs.
  return fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: action }, dataTambahan || {}))
  }).then(function (res) { return res.json(); });
}

// ---------------------------------------------------------
// Inisialisasi
// ---------------------------------------------------------

function gagalMuat(err) {
  document.getElementById('layarLoading').innerHTML = '<p>Gagal memuat: ' + err.message + '</p>';
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
        document.getElementById('layarLoading').innerHTML = '<p>' + hasil.pesan + '</p>';
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
