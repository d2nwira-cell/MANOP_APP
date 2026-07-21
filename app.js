// =========================================================
// KONFIGURASI -- WAJIB DIISI sebelum dipakai
// =========================================================
// Tempel URL deployment Apps Script Anda di sini (yang berakhiran /exec)
var API_BASE_URL = 'https://script.google.com/macros/s/AKfycbyK4L3eg46_gUMCo7nkWvLEt7VmP-RBC74-iWqVbHhdHbuZ42zsDuna3oB5dEMn1kJVvg/exec';

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
  masterLokasi: [],
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
      appState.role = hasil.role;
      document.getElementById('infoUser').textContent = hasil.nama + ' · ' + hasil.role;

      if (hasil.role === 'Owner') {
        document.getElementById('tabReview').classList.remove('hidden');
      }

      return apiGet('getMasterBarang').then(function (barang) {
        appState.masterBarang = barang;
        return apiGet('getMasterLokasi');
      }).then(function (lokasi) {
        appState.masterLokasi = lokasi;
        isiDropdownLokasi();
        return apiGet('getFieldTambahan', { initData: appState.initData, namaMenuBot: 'Pengajuan_Bahan_Baku' });
      }).then(function (field) {
        appState.fieldTambahan = field;
        renderFieldTambahan();
        terapkanTampilanJenis();
        tambahItem(); // mulai dengan 1 baris item kosong
        document.getElementById('layarLoading').classList.add('hidden');
        document.getElementById('layarUtama').classList.remove('hidden');
      });
    })
    .catch(gagalMuat);
}

function isiDropdownLokasi() {
  var select = document.getElementById('selectLokasiTujuan');
  appState.masterLokasi.forEach(function (lok) {
    var opt = document.createElement('option');
    opt.value = lok.idLokasi;
    opt.textContent = lok.namaLokasi;
    select.appendChild(opt);
  });
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
  terapkanTampilanJenis();
  renderDaftarItem();
});

/**
 * Atur field mana yang tampil sesuai jenis pengajuan terpilih:
 * - Bahan Baku: field tambahan (KPM) tampil (kalau kategori usaha cocok),
 *   Keperluan & Rekening & harga/total item TIDAK tampil
 * - Budget: kebalikannya -- Keperluan, Rekening, harga/total item tampil,
 *   field tambahan (KPM) TIDAK tampil (Budget tidak terikat Config_Field_Tambahan)
 */
function terapkanTampilanJenis() {
  var isiBudget = jenisTerpilih === 'Budget';

  document.getElementById('fieldDeskripsi').classList.toggle('hidden', !isiBudget);
  document.getElementById('fieldRekening').classList.toggle('hidden', !isiBudget);
  document.getElementById('totalChip').classList.toggle('hidden', !isiBudget);

  var areaFieldTambahan = document.getElementById('areaFieldTambahan');
  areaFieldTambahan.classList.toggle('hidden', isiBudget);
}

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
  var tampilkanHarga = jenisTerpilih === 'Budget';

  appState.items.forEach(function (item, index) {
    var card = document.createElement('div');
    card.className = 'item-card';

    var namaTampil = item.idBarang
      ? (appState.masterBarang.filter(function (b) { return b.idBarang === item.idBarang; })[0] || {}).namaBarang || ''
      : item.namaBarangKustom;

    card.innerHTML =
      '<div class="item-card-top"><span>Item ' + (index + 1) + '</span>' +
      '<button type="button" class="remove" data-hapus="' + index + '">Hapus</button></div>' +
      '<div class="field cari-barang-wrap">' +
      '<input type="text" autocomplete="off" placeholder="Cari atau ketik nama barang..." class="input-cari-barang" data-idx="' + index + '" value="' + (namaTampil || '').replace(/"/g, '&quot;') + '">' +
      '<div class="dropdown-barang hidden" data-idx="' + index + '"></div>' +
      '</div>' +
      '<div class="item-row">' +
      '<input type="number" min="0" placeholder="Jumlah" data-idx="' + index + '" data-key="qty" value="' + item.qty + '">' +
      '<input type="text" placeholder="Satuan" data-idx="' + index + '" data-key="satuan" value="' + item.satuan + '">' +
      '</div>' +
      (tampilkanHarga ? '<div class="field"><input type="number" min="0" placeholder="Perkiraan harga satuan" data-idx="' + index + '" data-key="perkiraanHarga" value="' + item.perkiraanHarga + '"></div>' : '');

    kontainer.appendChild(card);
  });

  // Input teks lain (qty, satuan, harga) -- perubahan langsung disimpan ke state
  kontainer.querySelectorAll('[data-key]').forEach(function (el) {
    el.addEventListener('input', function () {
      var idx = parseInt(el.dataset.idx, 10);
      var key = el.dataset.key;
      appState.items[idx][key] = (key === 'qty' || key === 'perkiraanHarga') ? (parseFloat(el.value) || 0) : el.value;
      hitungTotal();
    });
  });

  kontainer.querySelectorAll('[data-hapus]').forEach(function (el) {
    el.addEventListener('click', function () { hapusItem(parseInt(el.dataset.hapus, 10)); });
  });

  // Input pencarian barang -- tampilkan daftar tersaring saat mengetik
  kontainer.querySelectorAll('.input-cari-barang').forEach(function (inputEl) {
    var idx = parseInt(inputEl.dataset.idx, 10);
    var dropdownEl = kontainer.querySelector('.dropdown-barang[data-idx="' + idx + '"]');

    inputEl.addEventListener('input', function () {
      // Ketik bebas dianggap nama custom, sampai user memilih salah satu saran
      appState.items[idx].idBarang = '';
      appState.items[idx].namaBarangKustom = inputEl.value;
      tampilkanSaranBarang(inputEl.value, dropdownEl, idx, inputEl);
    });

    inputEl.addEventListener('focus', function () {
      tampilkanSaranBarang(inputEl.value, dropdownEl, idx, inputEl);
    });

    // Delay supaya klik pada saran sempat terdaftar sebelum dropdown ditutup
    inputEl.addEventListener('blur', function () {
      setTimeout(function () { dropdownEl.classList.add('hidden'); }, 150);
    });
  });

  hitungTotal();
}

function tampilkanSaranBarang(kataKunci, dropdownEl, idx, inputEl) {
  var kata = (kataKunci || '').toLowerCase().trim();
  var hasil = kata
    ? appState.masterBarang.filter(function (b) { return b.namaBarang.toLowerCase().indexOf(kata) !== -1; })
    : appState.masterBarang;
  hasil = hasil.slice(0, 20); // batasi supaya tidak terlalu panjang

  if (hasil.length === 0) {
    dropdownEl.innerHTML = '<div class="teks-kosong-dropdown">Tidak ditemukan -- akan disimpan sebagai barang custom</div>';
  } else {
    dropdownEl.innerHTML = hasil.map(function (b) {
      return '<div class="opsi-barang" data-pilih-idbarang="' + b.idBarang + '">' + b.namaBarang + '</div>';
    }).join('');
  }
  dropdownEl.classList.remove('hidden');

  dropdownEl.querySelectorAll('[data-pilih-idbarang]').forEach(function (opsiEl) {
    opsiEl.addEventListener('mousedown', function (e) {
      e.preventDefault(); // cegah blur duluan sebelum klik terdaftar
      var idBarang = opsiEl.dataset.pilihIdbarang;
      var barang = appState.masterBarang.filter(function (b) { return b.idBarang === idBarang; })[0];
      if (!barang) return;

      appState.items[idx].idBarang = barang.idBarang;
      appState.items[idx].namaBarangKustom = '';
      appState.items[idx].satuan = barang.satuan;
      if (jenisTerpilih === 'Budget') {
        appState.items[idx].perkiraanHarga = barang.hargaBarang;
      }

      inputEl.value = barang.namaBarang;
      dropdownEl.classList.add('hidden');
      renderDaftarItem(); // render ulang supaya satuan/harga ikut terisi
    });
  });
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

  var tanggalPemakaian = document.getElementById('inputTanggalPemakaian').value;
  var idLokasiTujuan = document.getElementById('selectLokasiTujuan').value;

  if (!tanggalPemakaian) {
    pesanStatus.textContent = 'Tanggal pemakaian wajib diisi.';
    pesanStatus.className = 'pesan-status error';
    return;
  }
  if (!idLokasiTujuan) {
    pesanStatus.textContent = 'Lokasi tujuan wajib dipilih.';
    pesanStatus.className = 'pesan-status error';
    return;
  }
  if (appState.items.length === 0) {
    pesanStatus.textContent = 'Minimal 1 item harus diisi.';
    pesanStatus.className = 'pesan-status error';
    return;
  }

  var fieldTambahan = {};
  if (jenisTerpilih === 'Bahan Baku') {
    document.querySelectorAll('[data-field-tambahan]').forEach(function (el) {
      fieldTambahan[el.dataset.fieldTambahan] = el.value;
    });
  }

  var formData = {
    jenisPengajuan: jenisTerpilih,
    tanggalPemakaian: tanggalPemakaian,
    idLokasiTujuan: idLokasiTujuan,
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
        perkiraanHarga: jenisTerpilih === 'Budget' ? item.perkiraanHarga : 0
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

// ---------------------------------------------------------
// Tab Bar (Ajukan / Review)
// ---------------------------------------------------------

document.getElementById('tabBar').addEventListener('click', function (e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  var tab = btn.dataset.tab;

  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');

  if (tab === 'ajukan') {
    document.getElementById('viewAjukan').classList.remove('hidden');
    document.getElementById('viewReview').classList.add('hidden');
    document.getElementById('judulHalaman').textContent = 'Pengajuan Baru';
  } else {
    document.getElementById('viewAjukan').classList.add('hidden');
    document.getElementById('viewReview').classList.remove('hidden');
    document.getElementById('judulHalaman').textContent = 'Review Pengajuan';
    muatDaftarReview();
  }
});

// ---------------------------------------------------------
// Review Pengajuan (khusus Owner)
// ---------------------------------------------------------

function formatRupiah(angka) {
  return 'Rp' + (angka || 0).toLocaleString('id-ID');
}

function muatDaftarReview() {
  var kontainer = document.getElementById('daftarReview');
  kontainer.innerHTML = '<p class="teks-kosong">Memuat daftar pengajuan...</p>';

  apiGet('getPengajuanPending', { initData: appState.initData })
    .then(function (hasil) {
      if (!hasil.sukses) {
        kontainer.innerHTML = '<p class="teks-kosong">' + hasil.pesan + '</p>';
        return;
      }

      var badge = document.getElementById('badgeReview');
      if (hasil.daftar.length > 0) {
        badge.textContent = hasil.daftar.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }

      if (hasil.daftar.length === 0) {
        kontainer.innerHTML = '<p class="teks-kosong">Tidak ada pengajuan yang menunggu review.</p>';
        return;
      }

      kontainer.innerHTML = '';
      hasil.daftar.forEach(function (p) {
        var card = document.createElement('div');
        card.className = 'review-card';

        var daftarItemHtml = p.items.map(function (it) {
          return '<li>' + it.namaBarang + ' — ' + it.qty + ' ' + it.satuan + ' (' + formatRupiah(it.perkiraanHarga) + '/unit)</li>';
        }).join('');

        card.innerHTML =
          '<div class="review-top"><span class="review-nama">' + p.namaPemohon + '</span><span class="review-jenis">' + p.jenisPengajuan + '</span></div>' +
          '<div class="review-deskripsi">' + (p.deskripsiUmum || '-') + '</div>' +
          '<ul class="review-items">' + daftarItemHtml + '</ul>' +
          '<div class="review-total">Total: ' + formatRupiah(p.totalNominal) + '</div>' +
          '<textarea class="catatan-review" placeholder="Catatan (opsional untuk setuju, wajib untuk tolak)"></textarea>' +
          '<div class="review-actions">' +
          '<button type="button" class="btn-tolak" data-id="' + p.idPengajuan + '" data-aksi="tolak">Tolak</button>' +
          '<button type="button" class="btn-setujui" data-id="' + p.idPengajuan + '" data-aksi="setuju">Setujui</button>' +
          '</div>';

        kontainer.appendChild(card);
      });

      kontainer.querySelectorAll('.review-actions button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          prosesKeputusan(btn, btn.dataset.id, btn.dataset.aksi === 'setuju');
        });
      });
    })
    .catch(function (err) {
      kontainer.innerHTML = '<p class="teks-kosong">Gagal memuat: ' + err.message + '</p>';
    });
}

function prosesKeputusan(btnDiklik, idPengajuan, disetujui) {
  var card = btnDiklik.closest('.review-card');
  var catatan = card.querySelector('.catatan-review').value;

  if (!disetujui && !catatan) {
    alert('Catatan wajib diisi kalau menolak pengajuan.');
    return;
  }

  card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  btnDiklik.textContent = 'Memproses...';

  apiGet('approveTolakPengajuan', {
    initData: appState.initData,
    idPengajuan: idPengajuan,
    disetujui: disetujui,
    catatan: catatan
  }).then(function (hasil) {
    if (!hasil.sukses) {
      alert(hasil.pesan);
      card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
      btnDiklik.textContent = disetujui ? 'Setujui' : 'Tolak';
      return;
    }
    card.style.opacity = '0.4';
    card.innerHTML = '<p style="text-align:center; margin:0;">' + (disetujui ? '✅ Disetujui' : '🚫 Ditolak') + '</p>';
    var badge = document.getElementById('badgeReview');
    var sisa = parseInt(badge.textContent || '0', 10) - 1;
    if (sisa > 0) { badge.textContent = sisa; } else { badge.classList.add('hidden'); }
  }).catch(function (err) {
    alert('Gagal memproses: ' + err.message);
    card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    btnDiklik.textContent = disetujui ? 'Setujui' : 'Tolak';
  });
}
