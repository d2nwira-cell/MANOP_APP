// =========================================================
// KONFIGURASI -- WAJIB DIISI sebelum dipakai
// =========================================================
// Tempel URL deployment Apps Script Anda di sini (yang berakhiran /exec)
var API_BASE_URL = 'https://script.google.com/macros/s/AKfycby3YZvm3G8_pH64gg2f36zmNeYPDg9RT_fuR5MF18B8Up-14PYCEFxpcbrf0iggtbeV1g/exec';

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
      if (hasil.role === 'Owner' || hasil.role === 'Purchasing') {
        document.getElementById('tabPO').classList.remove('hidden');
      }

      return apiGet('getMasterBarang').then(function (barang) {
        appState.masterBarang = barang;
        return apiGet('getMasterLokasi');
      }).then(function (lokasi) {
        if (!Array.isArray(lokasi)) {
          throw new Error('Server tidak mengembalikan daftar lokasi yang benar. Isi diterima: ' + JSON.stringify(lokasi));
        }
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
  document.getElementById('fieldJumlahBudget').classList.toggle('hidden', !isiBudget);
  document.getElementById('sectionDaftarItem').classList.toggle('hidden', isiBudget);

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
  appState.items.push({ idBarang: '', namaBarangKustom: '', qty: 1, satuan: '' });
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
      '</div>';

    kontainer.appendChild(card);
  });

  // Input qty & satuan -- perubahan langsung disimpan ke state
  kontainer.querySelectorAll('[data-key]').forEach(function (el) {
    el.addEventListener('input', function () {
      var idx = parseInt(el.dataset.idx, 10);
      var key = el.dataset.key;
      appState.items[idx][key] = (key === 'qty') ? (parseFloat(el.value) || 0) : el.value;
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

      inputEl.value = barang.namaBarang;
      dropdownEl.classList.add('hidden');
      renderDaftarItem(); // render ulang supaya satuan ikut terisi
    });
  });
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
  var isiBudget = jenisTerpilih === 'Budget';

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

  var jumlahBudget = parseFloat(document.getElementById('inputJumlahBudget').value) || 0;

  if (isiBudget) {
    if (!document.getElementById('inputDeskripsi').value) {
      pesanStatus.textContent = 'Rincian kebutuhan wajib diisi.';
      pesanStatus.className = 'pesan-status error';
      return;
    }
    if (jumlahBudget <= 0) {
      pesanStatus.textContent = 'Perkiraan jumlah budget wajib diisi.';
      pesanStatus.className = 'pesan-status error';
      return;
    }
  } else if (appState.items.length === 0) {
    pesanStatus.textContent = 'Minimal 1 item harus diisi.';
    pesanStatus.className = 'pesan-status error';
    return;
  }

  var fieldTambahan = {};
  if (!isiBudget) {
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
    itemList: isiBudget ? [] : appState.items.map(function (item) {
      var barang = appState.masterBarang.filter(function (b) { return b.idBarang === item.idBarang; })[0];
      return {
        idBarang: item.idBarang,
        namaBarangDatabase: barang ? barang.namaBarang : '',
        namaBarangKustom: item.namaBarangKustom,
        qty: item.qty,
        satuan: item.satuan
      };
    }),
    fieldTambahan: fieldTambahan,
    totalNominalManual: isiBudget ? jumlahBudget : 0
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
// Tab Bar (Ajukan / Terima / Review)
// ---------------------------------------------------------

var SEMUA_VIEW = ['viewAjukan', 'viewTerima', 'viewPo', 'viewReview'];
var JUDUL_PER_TAB = { ajukan: 'Pengajuan Baru', terima: 'Laporan Penerimaan', po: 'Purchase Order', review: 'Review' };

document.getElementById('tabBar').addEventListener('click', function (e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  var tab = btn.dataset.tab;

  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');

  SEMUA_VIEW.forEach(function (idView) {
    document.getElementById(idView).classList.toggle('hidden', idView !== 'view' + tab.charAt(0).toUpperCase() + tab.slice(1));
  });
  document.getElementById('judulHalaman').textContent = JUDUL_PER_TAB[tab];

  if (tab === 'terima') muatPengajuanUntukPenerimaan();
  if (tab === 'review') muatDaftarReview();
  if (tab === 'po') muatTabPO();
});

// ---------------------------------------------------------
// Review Pengajuan (khusus Owner)
// ---------------------------------------------------------

function formatRupiah(angka) {
  return 'Rp' + (angka || 0).toLocaleString('id-ID');
}

function muatDaftarReview() {
  muatDaftarReviewPengajuan();
  muatDaftarReviewPenerimaan();
}

function perbaruiBadgeReview() {
  var totalPengajuan = parseInt(document.getElementById('daftarReview').dataset.jumlah || '0', 10);
  var totalPenerimaan = parseInt(document.getElementById('daftarReviewPenerimaan').dataset.jumlah || '0', 10);
  var total = totalPengajuan + totalPenerimaan;
  var badge = document.getElementById('badgeReview');
  if (total > 0) {
    badge.textContent = total;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function muatDaftarReviewPengajuan() {
  var kontainer = document.getElementById('daftarReview');
  kontainer.innerHTML = '<p class="teks-kosong">Memuat daftar pengajuan...</p>';

  apiGet('getPengajuanPending', { initData: appState.initData })
    .then(function (hasil) {
      if (!hasil.sukses) {
        kontainer.innerHTML = '<p class="teks-kosong">' + hasil.pesan + '</p>';
        return;
      }

      kontainer.dataset.jumlah = hasil.daftar.length;
      perbaruiBadgeReview();

      if (hasil.daftar.length === 0) {
        kontainer.innerHTML = '<p class="teks-kosong">Tidak ada pengajuan yang menunggu review.</p>';
        return;
      }

      kontainer.innerHTML = '';
      hasil.daftar.forEach(function (p) {
        var card = document.createElement('div');
        card.className = 'review-card';

        var daftarItemHtml = p.items.map(function (it) {
          return '<li>' + it.namaBarang + ' — ' + it.qty + ' ' + it.satuan + '</li>';
        }).join('');

        card.innerHTML =
          '<div class="review-top"><span class="review-nama">' + p.namaPemohon + '</span><span class="review-jenis">' + p.jenisPengajuan + '</span></div>' +
          '<div class="review-deskripsi">' + (p.deskripsiUmum || '-') + '</div>' +
          (daftarItemHtml ? '<ul class="review-items">' + daftarItemHtml + '</ul>' : '') +
          (p.totalNominal > 0 ? '<div class="review-total">Perkiraan Budget: ' + formatRupiah(p.totalNominal) + '</div>' : '') +
          '<textarea class="catatan-review" placeholder="Catatan (opsional untuk setuju, wajib untuk tolak)"></textarea>' +
          '<div class="review-actions">' +
          '<button type="button" class="btn-tolak" data-id="' + p.idPengajuan + '" data-aksi="tolak">Tolak</button>' +
          '<button type="button" class="btn-setujui" data-id="' + p.idPengajuan + '" data-aksi="setuju">Setujui</button>' +
          '</div>';

        kontainer.appendChild(card);
      });

      kontainer.querySelectorAll('.review-actions button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          prosesKeputusan(btn, btn.dataset.id, btn.dataset.aksi === 'setuju', 'approveTolakPengajuan', 'idPengajuan', kontainer);
        });
      });
    })
    .catch(function (err) {
      kontainer.innerHTML = '<p class="teks-kosong">Gagal memuat: ' + err.message + '</p>';
    });
}

function muatDaftarReviewPenerimaan() {
  var kontainer = document.getElementById('daftarReviewPenerimaan');
  kontainer.innerHTML = '<p class="teks-kosong">Memuat daftar laporan...</p>';

  apiGet('getLaporanPenerimaanPending', { initData: appState.initData })
    .then(function (hasil) {
      if (!hasil.sukses) {
        kontainer.innerHTML = '<p class="teks-kosong">' + hasil.pesan + '</p>';
        return;
      }

      kontainer.dataset.jumlah = hasil.daftar.length;
      perbaruiBadgeReview();

      if (hasil.daftar.length === 0) {
        kontainer.innerHTML = '<p class="teks-kosong">Tidak ada laporan penerimaan yang menunggu review.</p>';
        return;
      }

      kontainer.innerHTML = '';
      hasil.daftar.forEach(function (p) {
        var card = document.createElement('div');
        card.className = 'review-card';

        var daftarItemHtml = p.items.map(function (it) {
          return '<li>' + it.namaBarang + ' — ' + it.qtyDiterima + ' ' + it.satuan + ' (' + it.kondisi + ')' +
            (it.urlFoto ? '<br><img src="' + it.urlFoto + '" class="preview-foto" style="max-height:100px; margin-top:4px;"/>' : '') +
            '</li>';
        }).join('');

        card.innerHTML =
          '<div class="review-top"><span class="review-nama">' + p.namaPelapor + '</span><span class="review-jenis">' + (p.idPengajuanTerkait ? 'Pengajuan ' + p.idPengajuanTerkait : 'Kiriman Langsung') + '</span></div>' +
          '<ul class="review-items">' + daftarItemHtml + '</ul>' +
          '<textarea class="catatan-review" placeholder="Catatan (opsional untuk setuju, wajib untuk tolak)"></textarea>' +
          '<div class="review-actions">' +
          '<button type="button" class="btn-tolak" data-id="' + p.idPenerimaan + '" data-aksi="tolak">Tolak</button>' +
          '<button type="button" class="btn-setujui" data-id="' + p.idPenerimaan + '" data-aksi="setuju">Setujui</button>' +
          '</div>';

        kontainer.appendChild(card);
      });

      kontainer.querySelectorAll('.review-actions button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          prosesKeputusan(btn, btn.dataset.id, btn.dataset.aksi === 'setuju', 'approveTolakLaporanPenerimaan', 'idPenerimaan', kontainer);
        });
      });
    })
    .catch(function (err) {
      kontainer.innerHTML = '<p class="teks-kosong">Gagal memuat: ' + err.message + '</p>';
    });
}

function prosesKeputusan(btnDiklik, idValue, disetujui, namaAksi, namaParamId, kontainerAsal) {
  var card = btnDiklik.closest('.review-card');
  var catatan = card.querySelector('.catatan-review').value;

  if (!disetujui && !catatan) {
    alert('Catatan wajib diisi kalau menolak.');
    return;
  }

  card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  btnDiklik.textContent = 'Memproses...';

  var params = { initData: appState.initData, disetujui: disetujui, catatan: catatan };
  params[namaParamId] = idValue;

  apiGet(namaAksi, params).then(function (hasil) {
    if (!hasil.sukses) {
      alert(hasil.pesan);
      card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
      btnDiklik.textContent = disetujui ? 'Setujui' : 'Tolak';
      return;
    }
    card.style.opacity = '0.4';
    card.innerHTML = '<p style="text-align:center; margin:0;">' + (disetujui ? '✅ Disetujui' : '🚫 Ditolak') + '</p>';
    var sisa = parseInt(kontainerAsal.dataset.jumlah || '0', 10) - 1;
    kontainerAsal.dataset.jumlah = Math.max(sisa, 0);
    perbaruiBadgeReview();
  }).catch(function (err) {
    alert('Gagal memproses: ' + err.message);
    card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    btnDiklik.textContent = disetujui ? 'Setujui' : 'Tolak';
  });
}

// ---------------------------------------------------------
// Laporan Penerimaan
// ---------------------------------------------------------

var itemsPenerimaan = []; // { idBarang, namaBarang, qtyDiajukan, satuan, qtyDiterima, kondisi, fotoBase64, fotoMime, urlFoto, statusUpload }

function muatPengajuanUntukPenerimaan() {
  var select = document.getElementById('selectPengajuanPenerimaan');
  // Tandai SEGERA (sebelum request async dikirim) -- kalau tab di-tap
  // dua kali berturut-turut dengan cepat, percobaan kedua langsung
  // dihentikan di sini, tidak menunggu balasan server dulu baru ditandai.
  if (select.dataset.termuat === '1' || select.dataset.sedangMemuat === '1') return;
  select.dataset.sedangMemuat = '1';

  apiGet('getPengajuanUntukPenerimaan', { initData: appState.initData })
    .then(function (hasil) {
      select.dataset.sedangMemuat = '';
      if (!hasil.sukses) {
        alert(hasil.pesan);
        return;
      }
      appState.daftarPengajuanPenerimaan = hasil.daftar;
      hasil.daftar.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.idPengajuan;
        opt.textContent = p.idPengajuan + ' — ' + formatTanggalTampil(p.tanggalPemakaian || p.tanggalPengajuan);
        select.appendChild(opt);
      });
      select.dataset.termuat = '1';
    })
    .catch(function (err) { select.dataset.sedangMemuat = ''; alert('Gagal memuat daftar pengajuan: ' + err.message); });
}

/**
 * Ubah "2026-07-20" jadi "20 Jul 2026" supaya enak dibaca di dropdown/kartu.
 * Aman dipakai untuk string apapun -- kalau bukan format tanggal yang
 * dikenali, dikembalikan apa adanya.
 */
function formatTanggalTampil(nilaiTanggal) {
  if (!nilaiTanggal) return '-';
  var cocok = /^(\d{4})-(\d{2})-(\d{2})/.exec(nilaiTanggal);
  if (!cocok) return nilaiTanggal;
  var namaBulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return parseInt(cocok[3], 10) + ' ' + namaBulan[parseInt(cocok[2], 10) - 1] + ' ' + cocok[1];
}

document.getElementById('selectPengajuanPenerimaan').addEventListener('change', function () {
  var pilihan = this.value;
  var submitBar = document.getElementById('submitBarPenerimaan');
  var btnTambah = document.getElementById('btnTambahItemPenerimaan');

  if (!pilihan) {
    itemsPenerimaan = [];
    document.getElementById('daftarItemPenerimaan').innerHTML = '';
    submitBar.classList.add('hidden');
    btnTambah.classList.add('hidden');
    return;
  }

  if (pilihan === '_TANPA_') {
    // Kiriman langsung tanpa pengajuan -- mulai dengan daftar kosong,
    // user tambah item manual satu-satu lewat tombol "+ Tambah Item Lain"
    itemsPenerimaan = [];
  } else {
    var pengajuan = appState.daftarPengajuanPenerimaan.filter(function (p) { return p.idPengajuan === pilihan; })[0];
    if (!pengajuan) return;

    itemsPenerimaan = pengajuan.items.map(function (it) {
      return {
        asal: 'pengajuan',
        idBarang: it.idBarang,
        namaBarang: it.namaBarang,
        qtyDiajukan: it.qtyDiajukan,
        satuan: it.satuan,
        qtyDiterima: it.qtyDiajukan,
        kondisi: 'Baik',
        fotoBase64: null,
        fotoMime: null,
        urlFoto: null,
        statusUpload: null
      };
    });
  }

  renderItemPenerimaan();
  submitBar.classList.remove('hidden');
  btnTambah.classList.remove('hidden');
});

document.getElementById('btnTambahItemPenerimaan').addEventListener('click', function () {
  itemsPenerimaan.push({
    asal: 'manual',
    idBarang: '',
    namaBarang: '',
    namaBarangKustom: '',
    qtyDiajukan: null,
    satuan: '',
    qtyDiterima: 1,
    kondisi: 'Baik',
    fotoBase64: null,
    fotoMime: null,
    urlFoto: null,
    statusUpload: null
  });
  renderItemPenerimaan();
});

function renderItemPenerimaan() {
  var kontainer = document.getElementById('daftarItemPenerimaan');
  kontainer.innerHTML = '';

  itemsPenerimaan.forEach(function (item, index) {
    var card = document.createElement('div');
    card.className = 'item-card';

    var bagianAtas = item.asal === 'manual'
      ? '<div class="item-card-top"><span>Item Tambahan</span><button type="button" class="remove" data-hapus-item="' + index + '">Hapus</button></div>' +
        '<div class="field cari-barang-wrap">' +
        '<input type="text" autocomplete="off" placeholder="Cari atau ketik nama barang..." class="input-cari-barang-terima" data-idx="' + index + '" value="' + (item.namaBarang || item.namaBarangKustom || '').replace(/"/g, '&quot;') + '">' +
        '<div class="dropdown-barang hidden" data-idx-terima="' + index + '"></div>' +
        '</div>'
      : '<div class="item-card-top"><span>' + item.namaBarang + ' <span class="ref-qty">(diajukan: ' + item.qtyDiajukan + ' ' + item.satuan + ')</span></span></div>';

    card.innerHTML = bagianAtas +
      '<div class="item-row">' +
      '<input type="number" min="0" placeholder="Qty diterima" data-idx="' + index + '" data-key="qtyDiterima" value="' + item.qtyDiterima + '">' +
      '<input type="text" placeholder="Satuan" data-idx="' + index + '" data-key="satuan" value="' + item.satuan + '"' + (item.asal !== 'manual' ? ' readonly' : '') + '>' +
      '</div>' +
      '<div class="field"><select data-idx="' + index + '" data-key="kondisi">' +
      '<option value="Baik"' + (item.kondisi === 'Baik' ? ' selected' : '') + '>Baik</option>' +
      '<option value="Rusak"' + (item.kondisi === 'Rusak' ? ' selected' : '') + '>Rusak</option>' +
      '<option value="Kurang"' + (item.kondisi === 'Kurang' ? ' selected' : '') + '>Kurang</option>' +
      '</select></div>' +
      (item.urlFoto ? '<img src="' + item.urlFoto + '" class="preview-foto">' : (item.fotoBase64 ? '<img src="data:' + item.fotoMime + ';base64,' + item.fotoBase64 + '" class="preview-foto">' : '')) +
      '<button type="button" class="btn-ambil-foto" data-idx="' + index + '">📷 ' + (item.fotoBase64 || item.urlFoto ? 'Ganti Foto' : 'Ambil Foto') + '</button>' +
      '<input type="file" accept="image/*" capture="environment" class="hidden input-file-foto" data-idx="' + index + '">' +
      (item.statusUpload ? '<div class="status-upload ' + (item.statusUpload.tipe) + '">' + item.statusUpload.teks + '</div>' : '');

    kontainer.appendChild(card);
  });

  kontainer.querySelectorAll('[data-key]').forEach(function (el) {
    el.addEventListener('input', function () {
      var idx = parseInt(el.dataset.idx, 10);
      var key = el.dataset.key;
      itemsPenerimaan[idx][key] = key === 'qtyDiterima' ? (parseFloat(el.value) || 0) : el.value;
    });
  });

  kontainer.querySelectorAll('[data-hapus-item]').forEach(function (el) {
    el.addEventListener('click', function () {
      itemsPenerimaan.splice(parseInt(el.dataset.hapusItem, 10), 1);
      renderItemPenerimaan();
    });
  });

  // Pencarian barang untuk item manual -- pola sama seperti form Pengajuan
  kontainer.querySelectorAll('.input-cari-barang-terima').forEach(function (inputEl) {
    var idx = parseInt(inputEl.dataset.idx, 10);
    var dropdownEl = kontainer.querySelector('.dropdown-barang[data-idx-terima="' + idx + '"]');

    inputEl.addEventListener('input', function () {
      itemsPenerimaan[idx].idBarang = '';
      itemsPenerimaan[idx].namaBarangKustom = inputEl.value;
      itemsPenerimaan[idx].namaBarang = inputEl.value;
      tampilkanSaranBarangTerima(inputEl.value, dropdownEl, idx, inputEl);
    });
    inputEl.addEventListener('focus', function () {
      tampilkanSaranBarangTerima(inputEl.value, dropdownEl, idx, inputEl);
    });
    inputEl.addEventListener('blur', function () {
      setTimeout(function () { dropdownEl.classList.add('hidden'); }, 150);
    });
  });

  kontainer.querySelectorAll('.btn-ambil-foto').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idx = parseInt(btn.dataset.idx, 10);
      kontainer.querySelector('.input-file-foto[data-idx="' + idx + '"]').click();
    });
  });

  kontainer.querySelectorAll('.input-file-foto').forEach(function (inputEl) {
    inputEl.addEventListener('change', function () {
      var idx = parseInt(inputEl.dataset.idx, 10);
      var file = inputEl.files[0];
      if (!file) return;

      itemsPenerimaan[idx].statusUpload = { tipe: '', teks: 'Memproses foto...' };
      renderItemPenerimaan();

      kompresFoto(file).then(function (hasil) {
        itemsPenerimaan[idx].fotoBase64 = hasil.base64;
        itemsPenerimaan[idx].fotoMime = hasil.mimeType;
        itemsPenerimaan[idx].urlFoto = null;
        itemsPenerimaan[idx].statusUpload = { tipe: 'sukses', teks: 'Foto siap, akan diupload saat kirim' };
        renderItemPenerimaan();
      }).catch(function (err) {
        itemsPenerimaan[idx].statusUpload = { tipe: 'error', teks: 'Gagal memproses foto: ' + err.message };
        renderItemPenerimaan();
      });
    });
  });
}

function tampilkanSaranBarangTerima(kataKunci, dropdownEl, idx, inputEl) {
  var kata = (kataKunci || '').toLowerCase().trim();
  var hasil = kata
    ? appState.masterBarang.filter(function (b) { return b.namaBarang.toLowerCase().indexOf(kata) !== -1; })
    : appState.masterBarang;
  hasil = hasil.slice(0, 20);

  dropdownEl.innerHTML = hasil.length === 0
    ? '<div class="teks-kosong-dropdown">Tidak ditemukan -- akan disimpan sebagai barang custom</div>'
    : hasil.map(function (b) { return '<div class="opsi-barang" data-pilih-idbarang="' + b.idBarang + '">' + b.namaBarang + '</div>'; }).join('');
  dropdownEl.classList.remove('hidden');

  dropdownEl.querySelectorAll('[data-pilih-idbarang]').forEach(function (opsiEl) {
    opsiEl.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var barang = appState.masterBarang.filter(function (b) { return b.idBarang === opsiEl.dataset.pilihIdbarang; })[0];
      if (!barang) return;
      itemsPenerimaan[idx].idBarang = barang.idBarang;
      itemsPenerimaan[idx].namaBarang = barang.namaBarang;
      itemsPenerimaan[idx].namaBarangKustom = '';
      itemsPenerimaan[idx].satuan = barang.satuan;
      inputEl.value = barang.namaBarang;
      dropdownEl.classList.add('hidden');
      renderItemPenerimaan();
    });
  });
}

function kompresFoto(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var maxDim = 1024;
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = function () { reject(new Error('Gagal membaca gambar')); };
      img.src = e.target.result;
    };
    reader.onerror = function () { reject(new Error('Gagal membaca file')); };
    reader.readAsDataURL(file);
  });
}

function uploadFotoBerpotongan(base64, mimeType, namaFile) {
  var UKURAN_POTONGAN = 4000;
  var sessionId = 'up_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
  var totalPotongan = Math.ceil(base64.length / UKURAN_POTONGAN);

  var rantai = Promise.resolve();
  for (var i = 0; i < totalPotongan; i++) {
    (function (i) {
      var potongan = base64.substr(i * UKURAN_POTONGAN, UKURAN_POTONGAN);
      rantai = rantai.then(function () {
        return apiGet('uploadFotoChunk', { sessionId: sessionId, chunkIndex: i, chunkData: potongan });
      });
    })(i);
  }

  return rantai.then(function () {
    return apiGet('uploadFotoSelesai', { sessionId: sessionId, totalChunks: totalPotongan, namaFile: namaFile, mimeType: mimeType });
  }).then(function (hasil) {
    if (!hasil.sukses) throw new Error(hasil.pesan);
    return hasil.url;
  });
}

document.getElementById('btnKirimPenerimaan').addEventListener('click', function () {
  var pesanStatus = document.getElementById('pesanStatusPenerimaan');
  pesanStatus.textContent = '';
  pesanStatus.className = 'pesan-status';

  var pilihan = document.getElementById('selectPengajuanPenerimaan').value;
  if (!pilihan) {
    pesanStatus.textContent = 'Pilih sumber penerimaan terlebih dahulu.';
    pesanStatus.className = 'pesan-status error';
    return;
  }
  var idPengajuanTerkait = pilihan === '_TANPA_' ? '' : pilihan;

  if (itemsPenerimaan.length === 0) {
    pesanStatus.textContent = 'Minimal 1 item harus diisi.';
    pesanStatus.className = 'pesan-status error';
    return;
  }

  var belumAdaNama = itemsPenerimaan.filter(function (it) { return !it.namaBarang; });
  if (belumAdaNama.length > 0) {
    pesanStatus.textContent = 'Semua item wajib punya nama barang.';
    pesanStatus.className = 'pesan-status error';
    return;
  }

  var belumAdaFoto = itemsPenerimaan.filter(function (it) { return !it.fotoBase64 && !it.urlFoto; });
  if (belumAdaFoto.length > 0) {
    pesanStatus.textContent = 'Semua item wajib punya foto sebelum dikirim.';
    pesanStatus.className = 'pesan-status error';
    return;
  }

  var btn = document.getElementById('btnKirimPenerimaan');
  btn.disabled = true;
  btn.textContent = 'Mengupload foto...';

  var rantaiUpload = Promise.resolve();
  itemsPenerimaan.forEach(function (item, idx) {
    if (item.urlFoto) return;
    rantaiUpload = rantaiUpload.then(function () {
      btn.textContent = 'Mengupload foto ' + (idx + 1) + '/' + itemsPenerimaan.length + '...';
      return uploadFotoBerpotongan(item.fotoBase64, item.fotoMime, 'penerimaan_' + idx + '.jpg')
        .then(function (url) { item.urlFoto = url; });
    });
  });

  rantaiUpload.then(function () {
    btn.textContent = 'Menyimpan laporan...';
    return apiGet('submitLaporanPenerimaan', {
      initData: appState.initData,
      idPengajuanTerkait: idPengajuanTerkait,
      itemsDiterima: JSON.stringify(itemsPenerimaan.map(function (it) {
        return {
          idBarang: it.idBarang || '',
          namaBarangDatabase: it.idBarang ? it.namaBarang : '',
          namaBarangKustom: it.idBarang ? '' : it.namaBarang,
          qtyDiterima: it.qtyDiterima,
          satuan: it.satuan,
          kondisi: it.kondisi,
          urlFoto: it.urlFoto
        };
      }))
    });
  }).then(function (hasil) {
    btn.disabled = false;
    btn.textContent = 'Kirim Laporan Penerimaan';
    if (!hasil.sukses) {
      pesanStatus.textContent = hasil.pesan;
      pesanStatus.className = 'pesan-status error';
      return;
    }
    document.getElementById('idPengajuanSukses').textContent = 'ID Laporan: ' + hasil.idPenerimaan;
    document.getElementById('layarUtama').classList.add('hidden');
    document.getElementById('layarSukses').classList.remove('hidden');
  }).catch(function (err) {
    btn.disabled = false;
    btn.textContent = 'Kirim Laporan Penerimaan';
    pesanStatus.textContent = 'Gagal: ' + err.message;
    pesanStatus.className = 'pesan-status error';
  });
});

// ---------------------------------------------------------
// Purchase Order
// ---------------------------------------------------------

function muatTabPO() {
  if (appState.role === 'Owner') {
    document.getElementById('buatPOSection').classList.remove('hidden');
    document.getElementById('poSayaSection').classList.add('hidden');
    muatDataBuatPO();
  } else if (appState.role === 'Purchasing') {
    document.getElementById('buatPOSection').classList.add('hidden');
    document.getElementById('poSayaSection').classList.remove('hidden');
    muatPOMilikSaya();
  }
}

function muatDataBuatPO() {
  var select = document.getElementById('selectPengajuanPO');
  if (select.dataset.termuat !== '1' && select.dataset.sedangMemuat !== '1') {
    select.dataset.sedangMemuat = '1';
    apiGet('getPengajuanUntukPO', { initData: appState.initData }).then(function (hasil) {
      select.dataset.sedangMemuat = '';
      if (!hasil.sukses) { alert(hasil.pesan); return; }
      appState.daftarPengajuanPO = hasil.daftar;

      if (hasil.daftar.length === 0) {
        var infoKosong = document.createElement('option');
        infoKosong.disabled = true;
        infoKosong.textContent = '(Tidak ada pengajuan tersisa -- mungkin semua item sudah di-PO-kan)';
        select.appendChild(infoKosong);
      }

      hasil.daftar.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.idPengajuan;
        opt.textContent = p.idPengajuan + ' — ' + p.namaPemohon;
        select.appendChild(opt);
      });
      select.dataset.termuat = '1';
    }).catch(function (err) { select.dataset.sedangMemuat = ''; alert('Gagal memuat daftar pengajuan: ' + err.message); });
  }

  if (!appState.daftarPurchasingTermuat) {
    apiGet('getDaftarPurchasing', { initData: appState.initData }).then(function (hasil) {
      if (!hasil.sukses) return;
      var sel = document.getElementById('selectPurchasing');
      hasil.daftar.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.telegramId;
        opt.textContent = p.nama;
        sel.appendChild(opt);
      });
      appState.daftarPurchasingTermuat = true;
    });
  }

  if (!appState.daftarSupplierTermuat) {
    apiGet('getDaftarSupplier', { initData: appState.initData }).then(function (hasil) {
      if (!hasil.sukses) return;
      appState.daftarSupplier = hasil.daftar;
      var sel = document.getElementById('selectSupplier');
      hasil.daftar.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.idSupplier;
        opt.textContent = s.namaSupplier;
        sel.appendChild(opt);
      });
      appState.daftarSupplierTermuat = true;
    });
  }
}

var itemsPOState = [];

document.getElementById('selectPengajuanPO').addEventListener('change', function () {
  var pilihan = this.value;
  itemsPOState = [];

  if (pilihan && pilihan !== '_TANPA_') {
    var pengajuan = (appState.daftarPengajuanPO || []).filter(function (p) { return p.idPengajuan === pilihan; })[0];
    if (pengajuan) {
      pengajuan.items.forEach(function (it) {
        if (it.sudahDiPO) return;
        itemsPOState.push({
          asal: 'pengajuan',
          idDetailPengajuan: it.idDetail,
          idBarang: it.idBarang,
          namaBarang: it.namaBarang,
          qty: it.qty,
          satuan: it.satuan,
          disertakan: true
        });
      });
    }
  }
  // pilihan === '_TANPA_' -> itemsPOState tetap kosong, user tambah item manual sendiri

  renderItemPO();
});

document.getElementById('btnTambahItemPO').addEventListener('click', function () {
  itemsPOState.push({
    asal: 'manual', idDetailPengajuan: null, idBarang: '', namaBarang: '', qty: 1, satuan: '', disertakan: true
  });
  renderItemPO();
});

/**
 * Render daftar item PO. Item dari pengajuan: checkbox sertakan/tidak +
 * QTY BISA DIEDIT (naik/turun dari yang diajukan semula). Item manual:
 * pencarian barang bebas (sama seperti form lain) + selalu ikut terkirim.
 */
function renderItemPO() {
  var kontainer = document.getElementById('daftarItemPO');
  kontainer.innerHTML = '';

  if (itemsPOState.length === 0) {
    kontainer.innerHTML = '<p class="teks-kosong">Belum ada item. Pilih pengajuan di atas, atau tambah item manual di bawah.</p>';
    return;
  }

  itemsPOState.forEach(function (item, index) {
    var card = document.createElement('div');
    card.className = 'item-card';

    var bagianAtas = item.asal === 'pengajuan'
      ? '<label class="item-card-top" style="cursor:pointer;">' +
        '<span style="display:flex; align-items:center; gap:8px;"><input type="checkbox" data-idx-po="' + index + '" data-key-po="disertakan"' + (item.disertakan ? ' checked' : '') + ' style="width:18px;height:18px;">' + item.namaBarang + '</span>' +
        '</label>'
      : '<div class="item-card-top"><span>Item Tambahan</span><button type="button" class="remove" data-hapus-po="' + index + '">Hapus</button></div>' +
        '<div class="field cari-barang-wrap">' +
        '<input type="text" autocomplete="off" placeholder="Cari atau ketik nama barang..." class="input-cari-barang-po" data-idx-po="' + index + '" value="' + (item.namaBarang || '').replace(/"/g, '&quot;') + '">' +
        '<div class="dropdown-barang hidden" data-idx-po-dd="' + index + '"></div>' +
        '</div>';

    card.innerHTML = bagianAtas +
      '<div class="item-row">' +
      '<input type="number" min="0" placeholder="Qty" data-idx-po="' + index + '" data-key-po="qty" value="' + item.qty + '">' +
      '<input type="text" placeholder="Satuan" data-idx-po="' + index + '" data-key-po="satuan" value="' + item.satuan + '">' +
      '</div>';

    kontainer.appendChild(card);
  });

  kontainer.querySelectorAll('[data-key-po]').forEach(function (el) {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function () {
      var idx = parseInt(el.dataset.idxPo, 10);
      var key = el.dataset.keyPo;
      if (key === 'disertakan') itemsPOState[idx].disertakan = el.checked;
      else if (key === 'qty') itemsPOState[idx].qty = parseFloat(el.value) || 0;
      else itemsPOState[idx][key] = el.value;
    });
  });

  kontainer.querySelectorAll('[data-hapus-po]').forEach(function (el) {
    el.addEventListener('click', function () {
      itemsPOState.splice(parseInt(el.dataset.hapusPo, 10), 1);
      renderItemPO();
    });
  });

  kontainer.querySelectorAll('.input-cari-barang-po').forEach(function (inputEl) {
    var idx = parseInt(inputEl.dataset.idxPo, 10);
    var dropdownEl = kontainer.querySelector('.dropdown-barang[data-idx-po-dd="' + idx + '"]');

    inputEl.addEventListener('input', function () {
      itemsPOState[idx].idBarang = '';
      itemsPOState[idx].namaBarang = inputEl.value;
      tampilkanSaranBarangPO(inputEl.value, dropdownEl, idx, inputEl);
    });
    inputEl.addEventListener('focus', function () {
      tampilkanSaranBarangPO(inputEl.value, dropdownEl, idx, inputEl);
    });
    inputEl.addEventListener('blur', function () {
      setTimeout(function () { dropdownEl.classList.add('hidden'); }, 150);
    });
  });
}

function tampilkanSaranBarangPO(kataKunci, dropdownEl, idx, inputEl) {
  var kata = (kataKunci || '').toLowerCase().trim();
  var hasil = kata
    ? appState.masterBarang.filter(function (b) { return b.namaBarang.toLowerCase().indexOf(kata) !== -1; })
    : appState.masterBarang;
  hasil = hasil.slice(0, 20);

  dropdownEl.innerHTML = hasil.length === 0
    ? '<div class="teks-kosong-dropdown">Tidak ditemukan -- akan disimpan sebagai barang custom</div>'
    : hasil.map(function (b) { return '<div class="opsi-barang" data-pilih-idbarang="' + b.idBarang + '">' + b.namaBarang + '</div>'; }).join('');
  dropdownEl.classList.remove('hidden');

  dropdownEl.querySelectorAll('[data-pilih-idbarang]').forEach(function (opsiEl) {
    opsiEl.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var barang = appState.masterBarang.filter(function (b) { return b.idBarang === opsiEl.dataset.pilihIdbarang; })[0];
      if (!barang) return;
      itemsPOState[idx].idBarang = barang.idBarang;
      itemsPOState[idx].namaBarang = barang.namaBarang;
      itemsPOState[idx].satuan = barang.satuan;
      inputEl.value = barang.namaBarang;
      dropdownEl.classList.add('hidden');
      renderItemPO();
    });
  });
}

document.getElementById('toggleTujuanPO').addEventListener('click', function (e) {
  var btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#toggleTujuanPO button').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var tujuan = btn.dataset.tujuan;
  document.getElementById('fieldPilihPurchasing').classList.toggle('hidden', tujuan !== 'purchasing');
  document.getElementById('fieldPilihSupplier').classList.toggle('hidden', tujuan !== 'supplier');
});

document.getElementById('btnBuatPO').addEventListener('click', function () {
  var pesanStatus = document.getElementById('pesanStatusPO');
  pesanStatus.innerHTML = '';
  pesanStatus.className = 'pesan-status';

  var pilihan = document.getElementById('selectPengajuanPO').value;
  if (!pilihan) {
    pesanStatus.textContent = 'Pilih sumber PO terlebih dahulu (pengajuan, atau Belanja Mendadak).';
    pesanStatus.className = 'pesan-status error';
    return;
  }
  var idPengajuan = pilihan === '_TANPA_' ? '' : pilihan;

  // Gabungkan item dari pengajuan (yang dicentang) + semua item manual
  var itemsPOTerkirim = itemsPOState.filter(function (it) {
    return it.asal === 'manual' ? !!it.namaBarang : it.disertakan;
  }).map(function (it) {
    return {
      idDetailPengajuan: it.idDetailPengajuan,
      idBarang: it.idBarang,
      namaBarang: it.namaBarang,
      qty: it.qty,
      satuan: it.satuan
    };
  });

  if (itemsPOTerkirim.length === 0) {
    pesanStatus.textContent = 'Pilih atau tambahkan minimal 1 item.';
    pesanStatus.className = 'pesan-status error';
    return;
  }

  var tujuanAktif = document.querySelector('#toggleTujuanPO button.active').dataset.tujuan;
  var penugasan;
  if (tujuanAktif === 'purchasing') {
    var telegramIdPurchasing = document.getElementById('selectPurchasing').value;
    if (!telegramIdPurchasing) {
      pesanStatus.textContent = 'Pilih staff purchasing.';
      pesanStatus.className = 'pesan-status error';
      return;
    }
    penugasan = { tipe: 'purchasing', telegramId: telegramIdPurchasing };
  } else {
    var idSupplier = document.getElementById('selectSupplier').value;
    if (!idSupplier) {
      pesanStatus.textContent = 'Pilih supplier.';
      pesanStatus.className = 'pesan-status error';
      return;
    }
    penugasan = { tipe: 'supplier', idSupplier: idSupplier };
  }

  var catatanPO = document.getElementById('inputCatatanPO').value;
  var btn = document.getElementById('btnBuatPO');
  btn.disabled = true;
  btn.textContent = 'Membuat PO...';

  apiGet('buatPO', {
    initData: appState.initData,
    idPengajuanInduk: idPengajuan,
    itemsPO: JSON.stringify(itemsPOTerkirim),
    penugasan: JSON.stringify(penugasan),
    catatan: catatanPO
  }).then(function (hasil) {
    btn.disabled = false;
    btn.textContent = 'Buat Purchase Order';
    if (!hasil.sukses) {
      pesanStatus.textContent = hasil.pesan;
      pesanStatus.className = 'pesan-status error';
      return;
    }

    if (tujuanAktif === 'supplier') {
      var supplier = (appState.daftarSupplier || []).filter(function (s) { return s.idSupplier === document.getElementById('selectSupplier').value; })[0];
      if (supplier && supplier.kontakSupplier) {
        var teksWA = bangunTeksWhatsAppPO(hasil.idPO, idPengajuan, itemsPOTerkirim, catatanPO);
        var linkWA = bangunLinkWhatsApp(supplier.kontakSupplier, teksWA);
        pesanStatus.innerHTML = '✅ PO berhasil dibuat: ' + hasil.idPO +
          '<br><a href="' + linkWA + '" target="_blank" class="tombol-wa">📲 Kirim ke WhatsApp Supplier</a>';
      } else {
        pesanStatus.textContent = '✅ PO berhasil dibuat: ' + hasil.idPO + ' (nomor kontak supplier belum tersedia di Master_Supplier)';
      }
    } else {
      pesanStatus.textContent = '✅ PO berhasil dibuat: ' + hasil.idPO;
    }
    pesanStatus.className = '';

    document.getElementById('inputCatatanPO').value = '';
    itemsPOState = [];
    renderItemPO();

    // Muat ulang daftar pengajuan supaya item yang baru dipakai tidak muncul lagi
    var select = document.getElementById('selectPengajuanPO');
    while (select.options.length > 2) select.remove(2);
    select.value = '';
    select.dataset.termuat = '';
    muatDataBuatPO();
  }).catch(function (err) {
    btn.disabled = false;
    btn.textContent = 'Buat Purchase Order';
    pesanStatus.textContent = 'Gagal: ' + err.message;
    pesanStatus.className = 'pesan-status error';
  });
});

/**
 * Susun teks ringkasan PO yang enak dibaca untuk dikirim ke Supplier
 * lewat WhatsApp.
 */
function bangunTeksWhatsAppPO(idPO, idPengajuan, items, catatan) {
  var daftarBaris = items.map(function (it) {
    return '- ' + it.namaBarang + ' : ' + it.qty + ' ' + it.satuan;
  }).join('\n');

  return '📋 *Purchase Order*\n' +
    'ID: ' + idPO + '\n' +
    'Ref. Pengajuan: ' + (idPengajuan || 'Belanja Mendadak (tanpa pengajuan)') + '\n\n' +
    'Item yang dibutuhkan:\n' + daftarBaris +
    (catatan ? '\n\nCatatan: ' + catatan : '') +
    '\n\nMohon segera diproses. Terima kasih.';
}

/**
 * Rapikan nomor kontak jadi format internasional (awalan 0 -> 62),
 * lalu bangun link wa.me dengan teks yang sudah terisi otomatis.
 */
function bangunLinkWhatsApp(nomorKontak, teks) {
  var bersih = (nomorKontak || '').replace(/[^0-9]/g, '');
  if (bersih.indexOf('0') === 0) bersih = '62' + bersih.substring(1);
  return 'https://wa.me/' + bersih + '?text=' + encodeURIComponent(teks);
}

function muatPOMilikSaya() {
  var kontainer = document.getElementById('daftarPOSaya');
  kontainer.innerHTML = '<p class="teks-kosong">Memuat...</p>';

  apiGet('getPOMilikSaya', { initData: appState.initData }).then(function (hasil) {
    if (!hasil.sukses) {
      kontainer.innerHTML = '<p class="teks-kosong">' + hasil.pesan + '</p>';
      return;
    }
    if (hasil.daftar.length === 0) {
      kontainer.innerHTML = '<p class="teks-kosong">Belum ada PO yang ditugaskan ke Anda.</p>';
      return;
    }

    kontainer.innerHTML = '';
    hasil.daftar.forEach(function (po) {
      var card = document.createElement('div');
      card.className = 'review-card';

      var daftarItemHtml = po.items.map(function (it) {
        return '<li>' + it.namaBarang + ' — ' + it.qty + ' ' + it.satuan + '</li>';
      }).join('');

      card.innerHTML =
        '<div class="review-top"><span class="review-nama">' + po.idPO + '</span><span class="review-jenis">' + po.statusPO + '</span></div>' +
        '<div class="review-deskripsi">' + (po.idPengajuanInduk ? 'Dari Pengajuan: ' + po.idPengajuanInduk : '🛒 Belanja Mendadak (tanpa pengajuan)') + (po.catatanManajer ? '<br>Catatan: ' + po.catatanManajer : '') + '</div>' +
        '<ul class="review-items">' + daftarItemHtml + '</ul>';

      kontainer.appendChild(card);
    });
  }).catch(function (err) {
    kontainer.innerHTML = '<p class="teks-kosong">Gagal memuat: ' + err.message + '</p>';
  });
}
