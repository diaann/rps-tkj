// Fungsi global untuk daftar dinamis "Lainnya" (Bentuk Asesmen Sumatif).
// Dipisah dari DOMContentLoaded karena dipanggil lewat atribut onclick inline
// (jadi harus ada di scope global/window), sama seperti pola tombol lain di
// file ini (mis. tombol "Hapus" pada sub-cpmk-item).
function lainnyaRowHtml(nama, bobot) {
    return `
        <div class="flex gap-1 items-center lainnya-row mb-1">
            <input type="text" class="input lainnya-nama" placeholder="Nama, contoh: Praktik / Studi Kasus" value="${nama || ''}" oninput="window.syncLainnyaRow(this)">
            <input type="number" min="0" max="100" class="input lainnya-bobot" style="max-width: 90px;" placeholder="Bobot (%)" value="${bobot || ''}" oninput="window.syncLainnyaRow(this)">
            <button type="button" class="btn-danger text-xs" onclick="window.removeLainnyaRow(this)">&times;</button>
        </div>
    `;
}

window.addLainnyaRow = function(btn) {
    const wrapper = btn.closest('.lainnya-wrapper');
    const list = wrapper.querySelector('.lainnya-list');
    list.insertAdjacentHTML('beforeend', lainnyaRowHtml('', ''));
    window.syncLainnyaFromWrapper(wrapper);
};

window.removeLainnyaRow = function(btn) {
    const wrapper = btn.closest('.lainnya-wrapper');
    btn.closest('.lainnya-row').remove();
    window.syncLainnyaFromWrapper(wrapper);
};

window.syncLainnyaRow = function(input) {
    window.syncLainnyaFromWrapper(input.closest('.lainnya-wrapper'));
};

window.syncLainnyaFromWrapper = function(wrapper) {
    if (!wrapper) return;
    const rows = wrapper.querySelectorAll('.lainnya-row');
    const items = Array.from(rows).map(row => ({
        nama: row.querySelector('.lainnya-nama').value.trim(),
        bobot: row.querySelector('.lainnya-bobot').value.trim()
    })).filter(item => item.nama || item.bobot);
    const hiddenInput = wrapper.querySelector('.lainnya-json');
    if (hiddenInput) hiddenInput.value = JSON.stringify(items);
};

document.addEventListener('DOMContentLoaded', function() {
    const rpsData = JSON.parse(document.getElementById('rps-data').textContent || '{}');
    const cplCheckboxes = document.querySelectorAll('input[name="cpl[]"]');
    const cpmkContainer = document.getElementById('cpmk-container');
    const subCpmkContainer = document.getElementById('sub-cpmk-container');
    const cpls = JSON.parse(document.getElementById('cpls-data').textContent || '[]');

    function ensureArray(value) {
        if (value === undefined || value === null || value === '') return [];
        return Array.isArray(value) ? value : [value];
    }

    // Parse existing CPMK entries from rpsData so we can render all CPMKs (including multiple per CPL)
    function parseExistingCpmks() {
        const cpmks = {}; // id -> { id, cpl_code, cpl_description, deskripsi }
        Object.keys(rpsData).forEach(key => {
            const m = key.match(/^cpmk\[(CPMK\d+)\]\[(\w+)\]$/);
            if (m) {
                const id = m[1];
                const field = m[2];
                cpmks[id] = cpmks[id] || { id };
                cpmks[id][field] = rpsData[key];
            }
        });
        return cpmks;
    }

    // Helper to compute next available CPMK id (CPMK01, CPMK02...)
    function nextCpmkId() {
        const existing = Array.from(document.querySelectorAll('input[name^="cpmk["]')).map(i => {
            const name = i.getAttribute('name');
            const m = name.match(/^cpmk\[(CPMK(\d+))\]\[cpl_code\]$/);
            return m ? m[1] : null;
        }).filter(Boolean);
        // Include those in rpsData as well
        const fromData = Object.keys(parseExistingCpmks()).map(k => k);
        const all = new Set([...existing, ...fromData]);
        let max = 0;
        all.forEach(id => {
            const m = id.match(/CPMK(\d+)/);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return `CPMK${String(max + 1).padStart(2, '0')}`;
    }

    // Generate CPMK fields, grouped by CPL and allowing multiples per CPL
    function generateCpmkFields() {
        cpmkContainer.innerHTML = '';

        const existingCpmks = parseExistingCpmks();

        // Build map cpl -> list of cpmk ids from existing data
        const cplMap = {};
        Object.values(existingCpmks).forEach(item => {
            const cpl = item.cpl_code || '';
            if (!cplMap[cpl]) cplMap[cpl] = [];
            cplMap[cpl].push(item);
        });

        // For each selected CPL, render a group with all existing CPMKs that reference it
        const selectedCpls = Array.from(cplCheckboxes).filter(cb => cb.checked);
        selectedCpls.forEach((cb) => {
            const cplCode = cb.value;
            const group = document.createElement('div');
            group.className = 'cpl-group mb-4 p-3 border rounded-md';
            group.innerHTML = `<div class="flex justify-between items-center mb-2"><h3 class="font-semibold">${cplCode}</h3></div>`;

            const list = document.createElement('div');
            list.className = 'cpmk-list';

            const items = cplMap[cplCode] || [];
            if (items.length > 0) {
                items.forEach(item => {
                    const id = item.id;
                    const desc = item.deskripsi || '';
                    const cpmkDiv = document.createElement('div');
                    cpmkDiv.className = 'cpmk-item mb-4 p-3 border rounded-md';
                    cpmkDiv.setAttribute('data-cpmk-id', id);
                    cpmkDiv.innerHTML = `
                        <h4 class="font-semibold text-md mb-2">${id} (merujuk pada ${cplCode})</h4>
                        <input type="hidden" name="cpmk[${id}][cpl_code]" value="${cplCode}">
                        <input type="hidden" name="cpmk[${id}][cpl_description]" value="${(cpls.find(x=>x.code===cplCode)||{}).desc || ''}">
                        <label class="label">Deskripsi CPMK:</label>
                        <textarea class="input" name="cpmk[${id}][deskripsi]" rows="3" required>${desc}</textarea>
                    `;
                    list.appendChild(cpmkDiv);
                });
            }

            // Append an Add button to allow adding more CPMK for this CPL
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'btn-primary';
            addBtn.textContent = `+ Tambah CPMK untuk ${cplCode}`;
            addBtn.onclick = () => addCPMKForCPL(cplCode);

            group.appendChild(list);
            group.appendChild(addBtn);
            cpmkContainer.appendChild(group);
        });

        // Also render any custom CPMKs (those without a CPL code)
        const custom = (Object.values(parseExistingCpmks()).filter(i => !i.cpl_code));
        if (custom.length > 0) {
            const holder = document.createElement('div');
            holder.className = 'custom-cpmk-holder mb-4';
            custom.forEach(item => {
                const id = item.id;
                const desc = item.deskripsi || '';
                const div = document.createElement('div');
                div.className = 'cpmk-item mb-4 p-3 border rounded-md';
                div.setAttribute('data-cpmk-id', id);
                div.innerHTML = `
                    <h4 class="font-semibold text-md mb-2">${id} (Manual)</h4>
                    <input type="hidden" name="cpmk[${id}][cpl_code]" value="">
                    <input type="hidden" name="cpmk[${id}][cpl_description]" value="">
                    <label class="label">Deskripsi CPMK:</label>
                    <textarea class="input" name="cpmk[${id}][deskripsi]" rows="3" required>${desc}</textarea>
                `;
                holder.appendChild(div);
            });
            cpmkContainer.appendChild(holder);
        }

        generateSubCpmkFields();
    }

    // Add a new CPMK for a specific CPL
    function addCPMKForCPL(cplCode) {
        const id = nextCpmkId();
        const cplData = cpls.find(c=>c.code===cplCode) || {};
        const div = document.createElement('div');
        div.className = 'cpmk-item mb-4 p-3 border rounded-md';
        div.setAttribute('data-cpmk-id', id);
        div.innerHTML = `
            <h4 class="font-semibold text-md mb-2">${id} (merujuk pada ${cplCode})</h4>
            <input type="hidden" name="cpmk[${id}][cpl_code]" value="${cplCode}">
            <input type="hidden" name="cpmk[${id}][cpl_description]" value="${cplData.desc || ''}">
            <label class="label">Deskripsi CPMK:</label>
            <textarea class="input" name="cpmk[${id}][deskripsi]" rows="3" required></textarea>
        `;

        // Insert into the appropriate group's list
        const groups = Array.from(document.querySelectorAll('.cpl-group'));
        for (const g of groups) {
            if (g.querySelector('h3') && g.querySelector('h3').textContent.trim() === cplCode) {
                const list = g.querySelector('.cpmk-list');
                list.appendChild(div);
                // Focus textarea
                setTimeout(()=> div.querySelector('textarea')?.focus(), 50);
                break;
            }
        }
        generateSubCpmkFields();
    }

    // Keep existing addCPMK for manual (no CPL) CPMKs
    function addCPMK() {
        const id = nextCpmkId();
        const div = document.createElement('div');
        div.className = 'cpmk-item mb-4 p-3 border rounded-md';
        div.setAttribute('data-cpmk-id', id);
        div.innerHTML = `
            <h4 class="font-semibold text-md mb-2">${id} (Manual)</h4>
            <input type="hidden" name="cpmk[${id}][cpl_code]" value="">
            <input type="hidden" name="cpmk[${id}][cpl_description]" value="">
            <label class="label">Deskripsi CPMK:</label>
            <textarea class="input" name="cpmk[${id}][deskripsi]" rows="3" required></textarea>
        `;

        // append to container directly (as manual block)
        cpmkContainer.appendChild(div);
        setTimeout(()=> div.querySelector('textarea')?.focus(), 50);
        generateSubCpmkFields();
    }

    // Function to generate Sub-CPMK fields
    function generateSubCpmkFields() {
        subCpmkContainer.innerHTML = '';
        const cpmkItems = document.querySelectorAll('.cpmk-item');

        cpmkItems.forEach((cpmkItem) => {
            // prefer data-cpmk-id if present, otherwise try to infer from hidden input
            let cpmkId = cpmkItem.getAttribute('data-cpmk-id');
            if (!cpmkId) {
                const hidden = cpmkItem.querySelector('input[name^="cpmk["][name$="[cpl_code]"]');
                if (hidden) {
                    const m = hidden.getAttribute('name').match(/^cpmk\[(CPMK\d+)\]\[cpl_code\]$/);
                    if (m) cpmkId = m[1];
                }
            }
            if (!cpmkId) return; // skip if can't determine id

            const subCpmkDiv = document.createElement('div');
            subCpmkDiv.id = `sub-cpmk-fields-${cpmkId}`;
            subCpmkDiv.className = 'sub-cpmk-group mb-4 p-3 border rounded-md';
            subCpmkDiv.innerHTML = `
                <div class="flex justify-between items-center mb-2">
                    <h4 class="font-semibold text-md cursor-pointer flex items-center"
                        onclick="toggleEditSubCpmkCollapse('sub-cpmk-list-${cpmkId}', this)">
                        <span class="collapse-icon mr-2">▼</span>
                        Detail untuk ${cpmkId}
                    </h4>
                </div>
                <div id="sub-cpmk-list-${cpmkId}" class="sub-cpmk-content">
                </div>
            `;

            // Find all sub-cpmks related to the current cpmkId
            const subCpmkKeys = Object.keys(rpsData).filter(key => key.startsWith(`sub_cpmk[${cpmkId}]`));
            const subCpmkData = {};

            subCpmkKeys.forEach(key => {
                const match = key.match(/\[(\d+)\]\[(\w+)\]/);
                if (match) {
                    const index = match[1];
                    const field = match[2];
                    if (!subCpmkData[index]) {
                        subCpmkData[index] = {};
                    }
                    subCpmkData[index][field] = rpsData[key];
                }
            });

            const listDiv = subCpmkDiv.querySelector(`#sub-cpmk-list-${cpmkId}`);
            Object.keys(subCpmkData).forEach(index => {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = createSubCpmkHtml(cpmkId, index, subCpmkData[index]);
                const el = wrapper.firstElementChild;
                if (el) {
                    el.setAttribute('data-subcpmk-index', index);
                    listDiv.appendChild(el);
                }
            });

            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.className = 'btn-primary mt-2';
            addButton.textContent = `+ Tambah Sub-CPMK untuk ${cpmkId}`;
            addButton.onclick = () => {
                if (window && typeof window.addSubCPMK === 'function') {
                    window.addSubCPMK(cpmkId);
                } else {
                    const newIndex = (listDiv.querySelectorAll('.sub-cpmk-item').length) + 1;
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = createSubCpmkHtml(cpmkId, newIndex);
                    const el = wrapper.firstElementChild;
                    if (el) el.setAttribute('data-subcpmk-index', newIndex);
                    listDiv.appendChild(el || wrapper);
                }
            };

            subCpmkDiv.appendChild(addButton);
            subCpmkContainer.appendChild(subCpmkDiv);
        });
    }

    function createLainnyaHtml(cpmkId, index, data = {}) {
        let items = [];
        try {
            const raw = data.sumatif_lainnya;
            items = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
        } catch (e) {
            items = [];
        }
        const rowsHtml = items.map(item => lainnyaRowHtml(item.nama, item.bobot)).join('');
        const jsonValue = JSON.stringify(items).replace(/"/g, '&quot;');
        return `
            <div class="lainnya-wrapper mt-3">
                <p class="text-xs font-semibold text-gray-600 mb-1">Lainnya</p>
                <div class="lainnya-list">${rowsHtml}</div>
                <button type="button" class="text-xs text-blue-600 hover:underline mt-1" onclick="window.addLainnyaRow(this)">+ Tambah Lainnya</button>
                <input type="hidden" class="lainnya-json" name="sub_cpmk[${cpmkId}][${index}][sumatif_lainnya]" value="${jsonValue}">
            </div>
        `;
    }

    function createSubCpmkHtml(cpmkId, index, data = {}) {
        // Normalize possible saved field names
        const hasLuring = !!(data.modalitas && data.modalitas.includes('luring')) || !!data.modalitas_luring || !!data.metode_luring;
        const hasDaring = !!(data.modalitas && data.modalitas.includes('daring')) || !!data.modalitas_daring || !!data.metode_daring;
        const metodeLuringVal = data.metode_luring || '';
        const metodeDaringVal = data.metode_daring || '';
        const selectedSubCpls = ensureArray(data.cpl);
        const availableCpls = Array.from(cplCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => ({ code: cb.value, desc: cb.getAttribute('data-description') || '' }));

        return `
            <div class="sub-cpmk-item border-t pt-3 mt-3">
                <div class="flex justify-between items-center mb-2">
                    <h5 class="font-semibold">Sub-CPMK #${data.global_number || index}</h5>
                    <button type="button" class="btn-danger" onclick="this.closest('.sub-cpmk-item').remove()">Hapus</button>
                </div>
                <input type="hidden" name="sub_cpmk[${cpmkId}][${index}][global_number]" value="${data.global_number || index}">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="label">Deskripsi Sub-CPMK</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][deskripsi]" rows="2" required>${data.deskripsi || ''}</textarea>
                    </div>
                    <div>
                        <label class="label">Pekan ke-</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="number" class="input" name="sub_cpmk[${cpmkId}][${index}][pekan_awal]" min="1" value="${data.pekan_awal || ''}" required placeholder="Awal">
                            <span>-</span>
                            <input type="number" class="input" name="sub_cpmk[${cpmkId}][${index}][pekan_akhir]" min="1" value="${data.pekan_akhir || ''}" required placeholder="Akhir">
                        </div>
                    </div>
                    <div>
                        <label class="label">Materi Pembelajaran</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][materi]" rows="2" required>${data.materi || ''}</textarea>
                    </div>
                    <div>
                        <label class="label">Durasi Waktu Pembelajaran (menit)</label>
                        <input class="input" name="sub_cpmk[${cpmkId}][${index}][durasi]" type="number" min="1" value="${data.durasi || ''}" required>
                    </div>
                    <div>
                        <label class="label">Indikator Penilaian</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][indikator]" rows="2" required>${data.indikator || ''}</textarea>
                    </div>
                    <div>
                        <label class="label">Teknik & Kriteria Penilaian</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][teknik_kriteria]" rows="2" required>${data.teknik_kriteria || ''}</textarea>
                    </div>
                    <div class="md:col-span-2">
                        <label class="label">Modalitas (Pilih minimal satu)</label>
                        <div class="mb-3">
                            <div class="flex items-center space-x-6 mb-2">
                                <label class="flex items-center">
                                    <input id="modalitas-checkbox-luring-${cpmkId}-${index}" type="checkbox" name="sub_cpmk[${cpmkId}][${index}][modalitas][]" value="luring" class="modalitas-checkbox mr-2" onchange="toggleModalitasInput('${cpmkId}', '${index}')" ${hasLuring ? 'checked' : ''}>
                                    <span class="text-sm font-medium">Luring (Offline)</span>
                                </label>
                                <label class="flex items-center">
                                    <input id="modalitas-checkbox-daring-${cpmkId}-${index}" type="checkbox" name="sub_cpmk[${cpmkId}][${index}][modalitas][]" value="daring" class="modalitas-checkbox mr-2" onchange="toggleModalitasInput('${cpmkId}', '${index}')" ${hasDaring ? 'checked' : ''}>
                                    <span class="text-sm font-medium">Daring (Online)</span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div class="md:col-span-2">
                        <label class="label">Metode Pembelajaran</label>
                        <div id="metode-luring-${cpmkId}-${index}" class="metode-input ${hasLuring ? '' : 'hidden'} mb-2">
                            <label class="block text-gray-600 text-xs font-bold mb-1">Metode Luring:</label>
                            <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][metode_luring]" rows="2" placeholder="Contoh: Ceramah, Praktikum, Diskusi">${metodeLuringVal}</textarea>
                        </div>
                        <div id="metode-daring-${cpmkId}-${index}" class="metode-input ${hasDaring ? '' : 'hidden'}">
                            <label class="block text-gray-600 text-xs font-bold mb-1">Metode Daring:</label>
                            <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][metode_daring]" rows="2" placeholder="Contoh: Webinar, E-Learning, Diskusi Online">${metodeDaringVal}</textarea>
                        </div>
                    </div>
                    <div>
                        <label class="label">Bentuk Pembelajaran</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][bentuk_pembelajaran]" rows="2">${data.bentuk_pembelajaran || ''}</textarea>
                    </div>
                    <div>
                        <label class="label">Strategi Pembelajaran</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][strategi_pembelajaran]" rows="2" required>${data.strategi_pembelajaran || ''}</textarea>
                    </div>
                    <!-- Metode removed per request: Edit RPS should not include generic 'metode' field -->
                    <div>
                        <label class="label">Media</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][media]" rows="2" required>${data.media || ''}</textarea>
                    </div>
                    <div>
                        <label class="label">Sumber Belajar</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][sumber_belajar]" rows="2" required>${data.sumber_belajar || ''}</textarea>
                    </div>
                    <div>
                        <label class="label">Alat dan Bahan</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][alat_bahan]" rows="2">${data.alat_bahan || ''}</textarea>
                    </div>
                    <div>
                        <label class="label">Pengalaman Belajar</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][pengalaman_belajar]" rows="2">${data.pengalaman_belajar || ''}</textarea>
                    </div>
                    <div>
                        <label class="label">Bentuk Penilaian</label>
                        <textarea class="input" name="sub_cpmk[${cpmkId}][${index}][bentuk_penilaian]" rows="2">${data.bentuk_penilaian || ''}</textarea>
                    </div>
                    <div>
                        <label class="label">Bobot Penilaian (%)</label>
                        <input class="input" name="sub_cpmk[${cpmkId}][${index}][bobot]" type="number" min="0" max="100" step="0.01" value="${data.bobot || ''}" required>
                    </div>
                    <div class="md:col-span-2 border rounded p-3 bg-gray-50">
                        <label class="label">Bentuk Asesmen</label>
                        <div class="mb-3">
                            <p class="text-xs font-semibold text-gray-600 mb-1">Formatif</p>
                            <input type="text" class="input mb-1" name="sub_cpmk[${cpmkId}][${index}][formatif_nama]" placeholder="Nama asesmen, contoh: Partisipasi dan Tanya jawab" value="${data.formatif_nama || ''}">
                            <input type="number" min="0" max="100" class="input" name="sub_cpmk[${cpmkId}][${index}][formatif_bobot]" placeholder="Bobot (%) -- opsional" value="${data.formatif_bobot || ''}">
                        </div>
                        <div>
                            <p class="text-xs font-semibold text-gray-600 mb-1">Sumatif</p>
                            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                                <div>
                                    <label class="block text-gray-600 text-xs mb-1">Kuis</label>
                                    <input type="text" class="input mb-1" name="sub_cpmk[${cpmkId}][${index}][sumatif_kuis_nama]" placeholder="Nama, contoh: Kuis 1" value="${data.sumatif_kuis_nama || ''}">
                                    <input type="number" min="0" max="100" class="input" name="sub_cpmk[${cpmkId}][${index}][sumatif_kuis_bobot]" placeholder="Bobot (%)" value="${data.sumatif_kuis_bobot || ''}">
                                </div>
                                <div>
                                    <label class="block text-gray-600 text-xs mb-1">Tugas</label>
                                    <input type="text" class="input mb-1" name="sub_cpmk[${cpmkId}][${index}][sumatif_tugas_nama]" placeholder="Nama, contoh: Laporan Singkat 1" value="${data.sumatif_tugas_nama || ''}">
                                    <input type="number" min="0" max="100" class="input" name="sub_cpmk[${cpmkId}][${index}][sumatif_tugas_bobot]" placeholder="Bobot (%)" value="${data.sumatif_tugas_bobot || ''}">
                                </div>
                                <div>
                                    <label class="block text-gray-600 text-xs mb-1">Ujian</label>
                                    <input type="text" class="input mb-1" name="sub_cpmk[${cpmkId}][${index}][sumatif_ujian_nama]" placeholder="Nama, contoh: UTS" value="${data.sumatif_ujian_nama || ''}">
                                    <input type="number" min="0" max="100" class="input" name="sub_cpmk[${cpmkId}][${index}][sumatif_ujian_bobot]" placeholder="Bobot (%)" value="${data.sumatif_ujian_bobot || ''}">
                                </div>
                                <div>
                                    <label class="block text-gray-600 text-xs mb-1">PjBL</label>
                                    <input type="text" class="input mb-1" name="sub_cpmk[${cpmkId}][${index}][sumatif_pjbl_nama]" placeholder="Nama, contoh: PjBL 1" value="${data.sumatif_pjbl_nama || ''}">
                                    <input type="number" min="0" max="100" class="input" name="sub_cpmk[${cpmkId}][${index}][sumatif_pjbl_bobot]" placeholder="Bobot (%)" value="${data.sumatif_pjbl_bobot || ''}">
                                </div>
                                <div>
                                    <label class="block text-gray-600 text-xs mb-1">Presentasi</label>
                                    <input type="text" class="input mb-1" name="sub_cpmk[${cpmkId}][${index}][sumatif_presentasi_nama]" placeholder="Nama, contoh: Presentasi 1" value="${data.sumatif_presentasi_nama || ''}">
                                    <input type="number" min="0" max="100" class="input" name="sub_cpmk[${cpmkId}][${index}][sumatif_presentasi_bobot]" placeholder="Bobot (%)" value="${data.sumatif_presentasi_bobot || ''}">
                                </div>
                            </div>
                            ${createLainnyaHtml(cpmkId, index, data)}
                        </div>
                    </div>
                    <div class="md:col-span-2">
                        <label class="label">CPL yang Tercakup</label>
                        <div class="flex flex-col space-y-1 text-sm text-gray-700">
                            ${availableCpls.length > 0
                                ? availableCpls.map(cpl => `
                                    <label class="flex items-center space-x-2">
                                        <input type="checkbox" name="sub_cpmk[${cpmkId}][${index}][cpl][]" value="${cpl.code}" class="mr-2" ${selectedSubCpls.includes(cpl.code) ? 'checked' : ''}>
                                        <span>${cpl.code}</span>
                                    </label>
                                `).join('')
                                : '<div class="text-sm text-gray-500">(Tidak ada CPL dipilih di bagian CPL)</div>'}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Expose helper to globally available so inline onclick works
    window.addCPMK = addCPMK;

    function getCpmkIdFromItem(cpmkItem) {
        if (!cpmkItem) return '';
        const fromData = cpmkItem.getAttribute('data-cpmk-id');
        if (fromData) return fromData;

        const hidden = cpmkItem.querySelector('input[name^="cpmk["][name$="[cpl_code]"]');
        if (!hidden) return '';

        const match = hidden.getAttribute('name').match(/^cpmk\[(CPMK\d+)\]\[cpl_code\]$/);
        return match ? match[1] : '';
    }

    function validateEditRpsStructure(form) {
        if (!form) return false;
        if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
            return false;
        }

        const selectedCpls = Array.from(cplCheckboxes).filter(cb => cb.checked);
        if (selectedCpls.length === 0) {
            alert('Mohon pilih minimal satu CPL sebelum memperbarui RPS.');
            return false;
        }

        const cpmkItems = Array.from(document.querySelectorAll('.cpmk-item'));
        if (cpmkItems.length === 0) {
            alert('Mohon tambahkan minimal satu CPMK sebelum memperbarui RPS.');
            return false;
        }

        for (const cpmkItem of cpmkItems) {
            const cpmkId = getCpmkIdFromItem(cpmkItem);
            const textarea = cpmkItem.querySelector('textarea[name^="cpmk["][name$="[deskripsi]"]');

            if (!textarea || !textarea.value.trim()) {
                if (textarea && typeof textarea.scrollIntoView === 'function') {
                    setTimeout(() => textarea.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                    textarea.focus();
                }
                alert(`Mohon isi deskripsi untuk ${cpmkId || 'CPMK'} sebelum memperbarui RPS.`);
                return false;
            }

            const subList = document.getElementById(`sub-cpmk-list-${cpmkId}`);
            const subCpmkItems = subList ? subList.querySelectorAll('[data-subcpmk-index]') : [];
            if (!subList || subCpmkItems.length === 0) {
                const target = subList || cpmkItem;
                if (target && typeof target.scrollIntoView === 'function') {
                    setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                }
                alert(`Mohon tambahkan minimal satu Sub-CPMK untuk ${cpmkId || 'CPMK'} sebelum memperbarui RPS.`);
                return false;
            }
        }

        return true;
    }

    // Always expose the edit-page variant so it overrides the create-page helper from script.js.
    window.addSubCPMK = function(cpmkId) {
        const list = document.querySelector(`#sub-cpmk-list-${cpmkId}`);
        if (!list) return;

        const usedIndexes = Array.from(list.querySelectorAll('[data-subcpmk-index]'))
            .map(item => parseInt(item.getAttribute('data-subcpmk-index'), 10))
            .filter(Number.isInteger);

        let newIndex = 1;
        while (usedIndexes.includes(newIndex)) {
            newIndex++;
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = createSubCpmkHtml(cpmkId, newIndex);
        const el = wrapper.firstElementChild;
        if (el) {
            el.setAttribute('data-subcpmk-index', newIndex);
            list.appendChild(el);
            return;
        }

        list.appendChild(wrapper);
    };

    cplCheckboxes.forEach(cb => {
        cb.addEventListener('change', generateCpmkFields);
    });

    // Initial generation
    generateCpmkFields();

    // Handle edit form submission (same as before)
    const editForm = document.getElementById('rps-form');
    if (editForm && editForm.action.includes('/edit-rps/')) {
        editForm.addEventListener('submit', function(e) {
            e.preventDefault(); // Prevent default form submission

            if (!validateEditRpsStructure(editForm)) {
                return;
            }

            // Validate modalitas/metode before submitting
            try {
                if (typeof validateModalitasForAll === 'function') {
                    const vm = validateModalitasForAll();
                    if (!vm.ok) {
                        alert(vm.message);
                        return;
                    }
                }
            } catch (err) {
                alert('Terjadi kesalahan saat memvalidasi Modalitas/Metode. Periksa kembali input Sub-CPMK.');
                return;
            }

            if (typeof syncCplDescriptionsForSubmit === 'function') {
                syncCplDescriptionsForSubmit(editForm);
            }

            // Show saving indicator
            const saveIndicator = document.createElement('div');
            saveIndicator.className = 'fixed top-4 right-4 bg-yellow-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
            saveIndicator.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Menyimpan...';
            document.body.appendChild(saveIndicator);

            // Create FormData and convert to URLSearchParams
            const formData = new FormData(editForm);
            const urlParams = new URLSearchParams();

            for (let [key, value] of formData.entries()) {
                urlParams.append(key, value);
            }

            // Submit via fetch
            fetch(editForm.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: urlParams
            })
            .then(response => response.json())
            .then(data => {
                // Remove saving indicator
                if (saveIndicator && saveIndicator.parentNode) {
                    saveIndicator.remove();
                }

                if (data.success) {
                    try { if (typeof showSaveSuccess === 'function') showSaveSuccess(); } catch (e) {}

                    const successIndicator = document.createElement('div');
                    successIndicator.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
                    successIndicator.innerHTML = `
                        <div class="flex items-center">
                            <i class="fas fa-check-circle mr-2"></i>
                            <div>
                                <div class="font-semibold">${data.message || 'RPS berhasil diperbarui!'}</div>
                                <div class="text-sm opacity-90">ID: ${data.id || ''}</div>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(successIndicator);

                    setTimeout(() => {
                        if (successIndicator && successIndicator.parentNode) successIndicator.remove();
                        window.location.href = '/history?updated=1';
                    }, 1200);
                } else {
                    throw new Error(data.message || 'Gagal memperbarui RPS');
                }
            })
            .catch(error => {
                if (saveIndicator && saveIndicator.parentNode) {
                    saveIndicator.remove();
                }

                console.error('Error updating RPS:', error);

                const errorIndicator = document.createElement('div');
                errorIndicator.className = 'fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
                errorIndicator.innerHTML = `
                    <div class="flex items-center">
                        <i class="fas fa-exclamation-triangle mr-2"></i>
                        <div>
                            <div class="font-semibold">Gagal memperbarui RPS</div>
                            <div class="text-sm opacity-90">${error.message}</div>
                        </div>
                    </div>
                `;
                document.body.appendChild(errorIndicator);

                setTimeout(() => {
                    if (errorIndicator && errorIndicator.parentNode) {
                        errorIndicator.remove();
                    }
                }, 5000);
            });
        });
    }
});
