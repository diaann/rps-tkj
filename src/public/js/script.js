
if (window.__RPS_SCRIPT_INITIALIZED) {
    // Already initialized in this page load. Avoid redeclaring variables/functions.
    // Re-expose important globals in case of partial reloads.
    if (typeof window.toggleModalitasInput === 'undefined' && typeof toggleModalitasInput === 'function') {
        window.toggleModalitasInput = toggleModalitasInput;
    }
    if (typeof window.validateModalitasForAll === 'undefined' && typeof validateModalitasForAll === 'function') {
        window.validateModalitasForAll = validateModalitasForAll;
    }
    if (typeof window.addSubCPMK === 'undefined' && typeof addSubCPMK === 'function') {
        window.addSubCPMK = addSubCPMK;
    }
} else {
    window.__RPS_SCRIPT_INITIALIZED = true;
}

let currentStep = 1;
const steps = document.querySelectorAll('.step');
let cpmkCounter = 0;
let subCpmkCounter = 0;

// Input bobot asesmen menerima koma maupun titik sebagai pemisah desimal
// (banyak dosen terbiasa menulis "4,5" ala format Indonesia). Field-nya
// bertipe text (bukan number) supaya browser tidak menolak koma sebelum
// sempat dinormalisasi di sini, lalu disamakan ke titik saat disimpan.
if (!window.__bobotHelpersInstalled) {
    window.__bobotHelpersInstalled = true;

    window.bobotVal = function(v) {
        if (v === undefined || v === null) return '';
        return String(v).trim().replace(/,/g, '.');
    };

    window.isValidBobotValue = function(value) {
        const trimmed = (value || '').toString().trim();
        if (trimmed === '') return true; // opsional, required dicek terpisah
        const num = Number(trimmed);
        return !Number.isNaN(num) && num >= 0 && num <= 100;
    };

    // Normalisasi ketikan koma->titik secara real-time untuk semua input
    // ".bobot-input", termasuk yang dibuat belakangan lewat innerHTML.
    document.addEventListener('input', function(e) {
        const el = e.target;
        if (!el.classList || !el.classList.contains('bobot-input')) return;
        const before = el.value;
        let value = before.replace(/,/g, '.').replace(/[^0-9.]/g, '');
        const firstDot = value.indexOf('.');
        if (firstDot !== -1) {
            value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '');
        }
        if (value !== before) {
            const pos = el.selectionStart || value.length;
            el.value = value;
            const newPos = Math.max(0, pos - (before.length - value.length));
            try { el.setSelectionRange(newPos, newPos); } catch (err) { /* ignore */ }
        }
    });

    window.validateBobotInputs = function(form) {
        const inputs = form.querySelectorAll('.bobot-input');
        for (const input of inputs) {
            if (!window.isValidBobotValue(input.value)) {
                if (typeof input.scrollIntoView === 'function') {
                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                input.focus();
                alert('Bobot asesmen harus berupa angka 0-100 (boleh pakai koma atau titik untuk desimal, contoh: 4,5 atau 4.5).');
                return false;
            }
            if (input.hasAttribute('required') && input.value.trim() === '') {
                if (typeof input.scrollIntoView === 'function') {
                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                input.focus();
                alert('Mohon isi Bobot Penilaian sebelum menyimpan.');
                return false;
            }
        }
        return true;
    };
}

// Fungsi global untuk daftar dinamis "Lainnya" (Bentuk Asesmen Sumatif).
// Sama persis dengan versi di edit-rps.js (dipertahankan di kedua file
// karena script.js dimuat di semua halaman lewat partials/footer.ejs,
// sedangkan edit-rps.js cuma di halaman Edit RPS).
if (typeof window.addLainnyaRow !== 'function') {
    window.lainnyaRowHtml = function(nama, bobot) {
        return `
            <div class="flex gap-1 items-center lainnya-row mb-1">
                <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 lainnya-nama" placeholder="Nama, contoh: Praktik / Studi Kasus" value="${nama || ''}" oninput="window.syncLainnyaRow(this)">
                <input type="text" inputmode="decimal" class="shadow appearance-none border rounded py-2 px-3 text-gray-700 lainnya-bobot bobot-input" style="max-width: 110px;" placeholder="Bobot (%)" value="${window.bobotVal(bobot)}" oninput="window.syncLainnyaRow(this)">
                <button type="button" class="text-red-600 text-xs px-2" onclick="window.removeLainnyaRow(this)">&times;</button>
            </div>
        `;
    };
    window.addLainnyaRow = function(btn) {
        const wrapper = btn.closest('.lainnya-wrapper');
        const list = wrapper.querySelector('.lainnya-list');
        list.insertAdjacentHTML('beforeend', window.lainnyaRowHtml('', ''));
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
}

// Global toggle function for modalitas/metode inputs so edit pages and inline handlers can call it
function toggleModalitasInput(cpmkId, subIndex, selectedType) {
    const luringCheckbox = document.getElementById(`modalitas-checkbox-luring-${cpmkId}-${subIndex}`) || document.querySelector(`input[name="sub_cpmk[${cpmkId}][${subIndex}][modalitas][]"][value="luring"]`);
    const daringCheckbox = document.getElementById(`modalitas-checkbox-daring-${cpmkId}-${subIndex}`) || document.querySelector(`input[name="sub_cpmk[${cpmkId}][${subIndex}][modalitas][]"][value="daring"]`);

    const metodeLuring = document.getElementById(`metode-luring-${cpmkId}-${subIndex}`);
    const metodeDaring = document.getElementById(`metode-daring-${cpmkId}-${subIndex}`);

    if (!metodeLuring || !metodeDaring) return;

    // Show/hide metode blocks based on checkbox state
    if (luringCheckbox && luringCheckbox.checked) {
        metodeLuring.classList.remove('hidden');
        const mt = metodeLuring.querySelector('textarea');
        if (mt) mt.required = true;
    } else {
        metodeLuring.classList.add('hidden');
        const mt = metodeLuring.querySelector('textarea');
        if (mt) {
            mt.required = false;
            if (!window.IS_EDIT_RPS) mt.value = '';
        }
    }

    if (daringCheckbox && daringCheckbox.checked) {
        metodeDaring.classList.remove('hidden');
        const mt2 = metodeDaring.querySelector('textarea');
        if (mt2) mt2.required = true;
    } else {
        metodeDaring.classList.add('hidden');
        const mt2 = metodeDaring.querySelector('textarea');
        if (mt2) {
            mt2.required = false;
            if (!window.IS_EDIT_RPS) mt2.value = '';
        }
    }

    // Persist state
    if (!window._initializing && !window._restoringSubCPMK) {
        saveFormState();
    }
}

// End of initialization guard block

// Validation helper for modalitas/metode per sub-CPMK: returns {ok: boolean, message: string}
function validateModalitasForAll() {
    const subLists = document.querySelectorAll('[id^="sub-cpmk-list-"]');
    for (const list of subLists) {
        const subItems = list.querySelectorAll('[data-subcpmk-index]');
        for (const item of subItems) {
            const idx = item.getAttribute('data-subcpmk-index');
            const idParts = list.id.match(/^sub-cpmk-list-(.+)$/);
            const cpmkId = idParts ? idParts[1] : null;
            // find checkboxes
            const luringCb = item.querySelector(`input[name="sub_cpmk[${cpmkId}][${idx}][modalitas][]"][value="luring"]`);
            const daringCb = item.querySelector(`input[name="sub_cpmk[${cpmkId}][${idx}][modalitas][]"][value="daring"]`);
            const anyChecked = (luringCb && luringCb.checked) || (daringCb && daringCb.checked);
            if (!anyChecked) {
                return { ok: false, message: `Mohon pilih minimal satu Modalitas untuk Sub-CPMK ${cpmkId}#${idx}` };
            }
            // if luring selected, ensure metode_luring (if displayed) has value
            if (luringCb && luringCb.checked) {
                const mt = item.querySelector(`#metode-luring-${cpmkId}-${idx} textarea`);
                if (mt && !mt.value.trim()) {
                    return { ok: false, message: `Mohon isi Metode Pembelajaran Luring untuk Sub-CPMK ${cpmkId}#${idx}` };
                }
            }
            if (daringCb && daringCb.checked) {
                const mt2 = item.querySelector(`#metode-daring-${cpmkId}-${idx} textarea`);
                if (mt2 && !mt2.value.trim()) {
                    return { ok: false, message: `Mohon isi Metode Pembelajaran Daring untuk Sub-CPMK ${cpmkId}#${idx}` };
                }
            }
        }
    }
    return { ok: true };
}

// Expose globals/aliases so inline handlers in server-rendered templates can call them
window.toggleModalitasInput = toggleModalitasInput;
window.toggleMetodeInput = function (cpmkId, subIndex, selectedType) {
    if (typeof window.toggleModalitasInput === 'function') {
        return window.toggleModalitasInput(cpmkId, subIndex, selectedType);
    }
};

// --- Visual Feedback Functions ---
function showAutoSaveIndicator() {
    // Remove existing indicator if any
    const existing = document.getElementById('auto-save-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.id = 'auto-save-indicator';
    indicator.className = 'fixed top-4 right-4 bg-yellow-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
    indicator.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Menyimpan...';
    document.body.appendChild(indicator);
}

function showSaveSuccess() {
    // Remove existing indicators
    const existing = document.getElementById('auto-save-indicator');
    if (existing) existing.remove();

    const successIndicator = document.getElementById('save-success-indicator');
    if (successIndicator) successIndicator.remove();

    const indicator = document.createElement('div');
    indicator.id = 'save-success-indicator';
    indicator.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
    indicator.innerHTML = '<i class="fas fa-check mr-2"></i>Tersimpan otomatis';
    document.body.appendChild(indicator);

    // Auto-remove after 2 seconds
    setTimeout(() => {
        if (indicator && indicator.parentNode) {
            indicator.remove();
        }
    }, 2000);
}

function showSaveError() {
    const existing = document.getElementById('auto-save-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.id = 'save-error-indicator';
    indicator.className = 'fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
    indicator.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i>Gagal menyimpan';
    document.body.appendChild(indicator);

    setTimeout(() => {
        if (indicator && indicator.parentNode) {
            indicator.remove();
        }
    }, 3000);
}

function syncCplDescriptionsForSubmit(form) {
    if (!form) return;

    document.querySelectorAll('input[name="cpl_deskripsi[]"]').forEach(el => el.remove());

    document.querySelectorAll('input[name="cpl[]"]:checked').forEach(checkbox => {
        const desc = checkbox.getAttribute('data-description');
        if (!desc) return;

        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'cpl_deskripsi[]';
        input.value = desc;
        form.appendChild(input);
    });
}

// --- State Persistence ---
function saveFormState() {
    // If we're on the Edit RPS page, do not persist or read localStorage for drafts
    if (window.IS_EDIT_RPS) return;
    // Don't save during initialization to prevent overwriting
    if (window._initializing || window._restoringSubCPMK) {
        return;
    }

    // Save current step
    localStorage.setItem('rps_currentStep', currentStep);

    // Save all basic form data
    const formData = {};
    const form = document.getElementById('rps-form');
    if (form) {
        const formDataObj = new FormData(form);
        for (let [key, value] of formDataObj.entries()) {
            if (!formData[key]) {
                formData[key] = [];
            }
            formData[key].push(value);
        }
    }
    localStorage.setItem('rps_formData', JSON.stringify(formData));

    // Save dynamic fields specifically
    const dosenPengampu = Array.from(document.querySelectorAll('input[name="dosen_pengampu[]"]')).map(input => input.value).filter(val => val.trim());
    const pustakaUtama = Array.from(document.querySelectorAll('textarea[name="pustaka_utama[]"]')).map(textarea => textarea.value).filter(val => val.trim());
    const pustakaPendukung = Array.from(document.querySelectorAll('textarea[name="pustaka_pendukung[]"]')).map(textarea => textarea.value).filter(val => val.trim());

    localStorage.setItem('rps_dosenPengampu', JSON.stringify(dosenPengampu));
    localStorage.setItem('rps_pustakaUtama', JSON.stringify(pustakaUtama));
    localStorage.setItem('rps_pustakaPendukung', JSON.stringify(pustakaPendukung));

    // Save CPL checked
    const cplCheckboxes = document.querySelectorAll('input[name="cpl[]"]');
    const checkedCPL = Array.from(cplCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
    localStorage.setItem('rps_checkedCPL', JSON.stringify(checkedCPL));
    // Save CPMK & Sub-CPMK
    const cpmkData = [];
    // Only consider parent CPMK elements with ids like CPMK01 (avoid -content duplicates)
    Array.from(document.querySelectorAll('div[id^="CPMK"]'))
        .filter(div => (/^CPMK\d+$/).test(div.id))
        .forEach(div => {
            const cpmkId = div.id;
            // Prefer the -content container if present
            const content = document.getElementById(`${cpmkId}-content`) || div;
            const cplCodeInput = content.querySelector('input[name^="cpmk["][name$="[cpl_code]"]') || content.querySelector('input[name^="cpmk["]');
            const cplDescInput = content.querySelector('input[name^="cpmk["][name$="[cpl_description]"]');
            const deskripsiTextarea = content.querySelector('textarea[name$="[deskripsi]"]');
            const cplCode = cplCodeInput ? cplCodeInput.value : '';
            const cplDesc = cplDescInput ? cplDescInput.value : '';
            const deskripsi = deskripsiTextarea ? deskripsiTextarea.value : '';
            cpmkData.push({ cpmkId, cplCode, cplDesc, deskripsi });
        });
    localStorage.setItem('rps_cpmkData', JSON.stringify(cpmkData));
    // Save Sub-CPMK - Enhanced saving mechanism
    const subCpmkData = [];
    document.querySelectorAll('[id^="sub-cpmk-list-"]').forEach(listDiv => {
        const cpmkId = listDiv.id.replace('sub-cpmk-list-', '');

        Array.from(listDiv.children).forEach(subDiv => {
            if (subDiv.hasAttribute('data-subcpmk-index')) {
                const idx = subDiv.getAttribute('data-subcpmk-index');
                const obj = {
                    cpmkId,
                    idx,
                    timestamp: Date.now()
                };

                // Collect all form data from this Sub-CPMK with more comprehensive selection
                // Include radios, checkboxes, hidden fields, numbers, textareas, selects
                const inputs = subDiv.querySelectorAll('textarea, input[type="text"], input[type="number"], input[type="radio"], input[type="checkbox"], input[type="hidden"], select');

                inputs.forEach(input => {
                    if (!input.name) return;

                    if (input.type === 'radio') {
                        // Save only the checked radio
                        if (input.checked) {
                            obj[input.name] = input.value || '';
                            const fieldMatch = input.name.match(/\[([^\]]+)\]$/);
                            if (fieldMatch) obj[fieldMatch[1]] = input.value || '';
                        }
                    } else if (input.type === 'checkbox') {
                        // Save checked checkboxes as an array
                        if (!obj[input.name]) obj[input.name] = [];
                        if (input.checked) obj[input.name].push(input.value || 'on');
                        const fieldMatch = input.name.match(/\[([^\]]+)\]$/);
                        if (fieldMatch) {
                            // also store simplified name as comma-separated string for compatibility
                            const fn = fieldMatch[1];
                            obj[fn] = (obj[fn] ? obj[fn] + ',' : '') + (input.checked ? (input.value || 'on') : '');
                        }
                    } else {
                        // text, number, hidden, select, textarea
                        obj[input.name] = input.value || '';
                        const fieldMatch = input.name.match(/\[([^\]]+)\]$/);
                        if (fieldMatch) obj[fieldMatch[1]] = input.value || '';
                    }
                });

                subCpmkData.push(obj);
            }
        });
    });

    // Save with error handling
    try {
        localStorage.setItem('rps_subCpmkData', JSON.stringify(subCpmkData));
    } catch (error) {
        // Try to save with reduced data if storage quota exceeded
        try {
            const essentialData = subCpmkData.map(item => ({
                cpmkId: item.cpmkId,
                idx: item.idx,
                deskripsi: item.deskripsi || '',
                pekan_awal: item.pekan_awal || '',
                pekan_akhir: item.pekan_akhir || ''
            }));
            localStorage.setItem('rps_subCpmkData', JSON.stringify(essentialData));
        } catch (fallbackError) {
            // Silent fail
        }
    }
}

function restoreFormState() {
    // If we're on the Edit RPS page, don't restore from localStorage
    if (window.IS_EDIT_RPS) return;
    // Only attempt to restore if the RPS form exists on this page
    const rpsFormEl = document.getElementById('rps-form');
    if (!rpsFormEl) return;
    // Restore step
    const savedStep = parseInt(localStorage.getItem('rps_currentStep'));
    if (savedStep && savedStep > 1) {
        currentStep = savedStep;
    }

    // Restore basic form data
    const formData = JSON.parse(localStorage.getItem('rps_formData') || '{}');
    Object.keys(formData).forEach(fieldName => {
        const elements = document.querySelectorAll(`[name="${fieldName}"]`);
        if (elements.length === 1) {
            // Single field
            const element = elements[0];
            if (element.type === 'checkbox' || element.type === 'radio') {
                element.checked = formData[fieldName].includes(element.value);
            } else {
                element.value = formData[fieldName][0] || '';
            }
        }
    });

    // Restore dynamic fields specifically
    restoreDynamicFields();

    // Restore CPL
    const checkedCPL = JSON.parse(localStorage.getItem('rps_checkedCPL') || '[]');
    if (checkedCPL.length) {
        document.querySelectorAll('input[name="cpl[]"]').forEach(cb => {
            if (checkedCPL.includes(cb.value)) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change'));
            }
        });
    }
    // Restore CPMK
    const cpmkData = JSON.parse(localStorage.getItem('rps_cpmkData') || '[]');
    // Buat section CPMK untuk setiap CPL yang ada CPMK-nya, hanya sekali per CPL
    const cplSectionMade = {};
    cpmkData.forEach(item => {
        if (!document.getElementById(`cpmk-list-${item.cplCode}`)) {
            // Buat section dengan trigger event change pada checkbox CPL
            const cplCheckbox = Array.from(document.querySelectorAll('input[name="cpl[]"]')).find(cb => cb.value === item.cplCode);
            if (cplCheckbox && !cplCheckbox.checked) {
                cplCheckbox.checked = true;
                cplCheckbox.dispatchEvent(new Event('change'));
            }
            cplSectionMade[item.cplCode] = true;
        }
    });
    // Setelah semua section dibuat, tambahkan CPMK-nya
    // Agar section benar-benar sudah ada, panggil restoreFormState sekali lagi (hanya sekali, pakai flag)
    if (!window._rps_restoreSecondPass) {
        window._rps_restoreSecondPass = true;
        setTimeout(restoreFormState, 0);
        return;
    } else {
        window._rps_restoreSecondPass = false;
    }
    cpmkData.forEach(item => {
        if (document.getElementById(`cpmk-list-${item.cplCode}`)) {
            addCPMK(item.cplCode, item.cplDesc, item.cpmkId, item.deskripsi);
        }
    });
    // Restore Sub-CPMK - defer until after CPMK sections are fully created
    setTimeout(() => {
        const subCpmkData = JSON.parse(localStorage.getItem('rps_subCpmkData') || '[]');

        if (subCpmkData.length === 0) {
            return;
        }

        // Group by cpmkId to ensure correct restoration order
        const groupedSubCpmk = {};
        subCpmkData.forEach(item => {
            if (!groupedSubCpmk[item.cpmkId]) {
                groupedSubCpmk[item.cpmkId] = [];
            }
            groupedSubCpmk[item.cpmkId].push(item);
        });

        // Restore each CPMK's Sub-CPMKs
        Object.keys(groupedSubCpmk).forEach(cpmkId => {
            const subList = document.getElementById(`sub-cpmk-list-${cpmkId}`);
            if (subList) {
                // Sort by index to maintain order
                groupedSubCpmk[cpmkId].sort((a, b) => parseInt(a.idx) - parseInt(b.idx));

                groupedSubCpmk[cpmkId].forEach((item, itemIndex) => {
                    // Add new sub-CPMK first - don't auto-save during restoration
                    window._restoringSubCPMK = true;
                    addSubCPMK(cpmkId, item.idx);

                    // Then set the values after a longer delay to ensure DOM is ready
                    setTimeout(() => {
                        const subDiv = Array.from(subList.children).find(div => div.getAttribute('data-subcpmk-index') == item.idx);

                        if (subDiv) {
                            // Enhanced restoration with better field matching
                            subDiv.querySelectorAll('textarea, input[type="text"], input[type="number"], input[type="radio"], select').forEach(input => {
                                if (input.name && item[input.name] !== undefined && item[input.name] !== null) {
                                    if (input.type === 'radio') {
                                        if (input.value === item[input.name]) {
                                            input.checked = true;
                                            // Trigger the toggle function for modalitas
                                            if (input.name.includes('[modalitas_type]')) {
                                                const matches = input.name.match(/sub_cpmk\[(.+?)\]\[(.+?)\]\[modalitas_type\]/);
                                                if (matches) {
                                                    setTimeout(() => {
                                                        toggleModalitasInput(matches[1], matches[2], input.value);
                                                    }, 100);
                                                }
                                            }
                                        }
                                    } else {
                                        input.value = item[input.name];
                                    }
                                } else if (input.name) {
                                    // Try simplified field name matching
                                    const fieldMatch = input.name.match(/\[([^\]]+)\]$/);
                                    if (fieldMatch) {
                                        const fieldName = fieldMatch[1];
                                        if (item[fieldName] !== undefined && item[fieldName] !== null) {
                                            if (input.type === 'radio') {
                                                if (input.value === item[fieldName]) {
                                                    input.checked = true;
                                                    // Trigger the toggle function for modalitas
                                                    if (input.name.includes('[modalitas_type]')) {
                                                        const matches = input.name.match(/sub_cpmk\[(.+?)\]\[(.+?)\]\[modalitas_type\]/);
                                                        if (matches) {
                                                            setTimeout(() => {
                                                                toggleModalitasInput(matches[1], matches[2], input.value);
                                                            }, 100);
                                                        }
                                                    }
                                                }
                                            } else {
                                                input.value = item[fieldName];
                                            }
                                        }
                                    }
                                }
                            });
                        }

                        // Clear restoration flag after last item
                        if (itemIndex === groupedSubCpmk[cpmkId].length - 1) {
                            setTimeout(() => {
                                window._restoringSubCPMK = false;
                            }, 100);
                        }
                    }, 300 + (itemIndex * 100)); // Increased stagger time for better reliability
                });
            }
        });
    }, 800); // Increased delay to ensure all CPMK sections are ready
    showStep(currentStep);
}

function restoreDynamicFields() {
    // Restore Dosen Pengampu
    const savedDosenPengampu = JSON.parse(localStorage.getItem('rps_dosenPengampu') || '[]');
    if (savedDosenPengampu.length > 0) {
        const container = document.getElementById('dosen-pengampu-container');
        if (container) {
            // Clear existing inputs except the first one
            const existingInputs = container.querySelectorAll('input[name="dosen_pengampu[]"]');
            for (let i = 1; i < existingInputs.length; i++) {
                existingInputs[i].parentElement.remove();
            }

            // Set values
            savedDosenPengampu.forEach((value, index) => {
                if (index === 0) {
                    // Set first input
                    const firstInput = container.querySelector('input[name="dosen_pengampu[]"]');
                    if (firstInput) firstInput.value = value;
                } else {
                    // Add new inputs
                    const newDiv = document.createElement('div');
                    newDiv.className = 'flex items-center mb-2';
                    newDiv.innerHTML = `
                        <input class="input" name="dosen_pengampu[]" type="text" value="${value}" required>
                        <button type="button" class="ml-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded" onclick="removeElementAndSave(this)">-</button>
                    `;
                    container.appendChild(newDiv);
                }
            });
        }
    }

    // Restore Pustaka Utama
    const savedPustakaUtama = JSON.parse(localStorage.getItem('rps_pustakaUtama') || '[]');
    if (savedPustakaUtama.length > 0) {
        const container = document.getElementById('pustaka-utama-list');
        if (container) {
            // Clear existing textareas except the first one
            const existingTextareas = container.querySelectorAll('textarea[name="pustaka_utama[]"]');
            for (let i = 1; i < existingTextareas.length; i++) {
                existingTextareas[i].parentElement.remove();
            }

            // Set values
            savedPustakaUtama.forEach((value, index) => {
                if (index === 0) {
                    // Set first textarea
                    const firstTextarea = container.querySelector('textarea[name="pustaka_utama[]"]');
                    if (firstTextarea) firstTextarea.value = value;
                } else {
                    // Add new textareas
                    const newDiv = document.createElement('div');
                    newDiv.className = 'flex items-start mb-2';
                    newDiv.innerHTML = `
                        <textarea class="input" name="pustaka_utama[]" rows="2" required>${value}</textarea>
                        <button type="button" class="ml-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded" onclick="removeElementAndSave(this)">-</button>
                    `;
                    container.appendChild(newDiv);
                }
            });
        }
    }

    // Restore Pustaka Pendukung
    const savedPustakaPendukung = JSON.parse(localStorage.getItem('rps_pustakaPendukung') || '[]');
    if (savedPustakaPendukung.length > 0) {
        const container = document.getElementById('pustaka-pendukung-list');
        if (container) {
            // Clear existing textareas except the first one
            const existingTextareas = container.querySelectorAll('textarea[name="pustaka_pendukung[]"]');
            for (let i = 1; i < existingTextareas.length; i++) {
                existingTextareas[i].parentElement.remove();
            }

            // Set values
            savedPustakaPendukung.forEach((value, index) => {
                if (index === 0) {
                    // Set first textarea
                    const firstTextarea = container.querySelector('textarea[name="pustaka_pendukung[]"]');
                    if (firstTextarea) firstTextarea.value = value;
                } else {
                    // Add new textareas
                    const newDiv = document.createElement('div');
                    newDiv.className = 'flex items-start mb-2';
                    newDiv.innerHTML = `
                        <textarea class="input" name="pustaka_pendukung[]" rows="2" required>${value}</textarea>
                        <button type="button" class="ml-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded" onclick="removeElementAndSave(this)">-</button>
                    `;
                    container.appendChild(newDiv);
                }
            });
        }
    }
}

// --- Storage Management ---
function clearFormStorage() {
    const keys = [
        'rps_currentStep',
        'rps_formData',
        'rps_dosenPengampu',
        'rps_pustakaUtama',
        'rps_pustakaPendukung',
        'rps_checkedCPL',
        'rps_cpmkData',
        'rps_subCpmkData'
    ];

    keys.forEach(key => {
        localStorage.removeItem(key);
    });

    // Silent clear
}

// Function to manually save current state (can be called from UI)
function manualSave() {
    try {
        showAutoSaveIndicator();
        saveFormState();
        // Manual save completed
    } catch (error) {
        // Manual save failed
    }
}

// Function to get storage info for debugging
function getStorageInfo() {
    const info = {};
    const keys = [
        'rps_currentStep',
        'rps_formData',
        'rps_dosenPengampu',
        'rps_pustakaUtama',
        'rps_pustakaPendukung',
        'rps_checkedCPL',
        'rps_cpmkData',
        'rps_subCpmkData'
    ];

    keys.forEach(key => {
        const data = localStorage.getItem(key);
        info[key] = data ? JSON.parse(data) : null;
    });

    // Show storage info in console for debugging
    return info;
}

function showStep(step) {
    steps.forEach((s, index) => {
        if (index + 1 === step) {
            s.classList.remove('hidden');
        } else {
            s.classList.add('hidden');
        }
    });
    // Jangan panggil saveFormState di sini!
}


function nextStep() {
    if (currentStep < steps.length) {
        currentStep++;
        showStep(currentStep);
        saveFormState();
    }
}


function prevStep() {
    if (currentStep > 1) {
        currentStep--;
        showStep(currentStep);
        saveFormState();
    }
}

function addDosenPengampu() {
    // Try to find the container, fall back to existing inputs if missing
    let container = document.getElementById('dosen-pengampu-container');
    if (!container) {
        const fallbackInputs = document.getElementsByName('dosen_pengampu[]');
        if (fallbackInputs && fallbackInputs.length > 0) {
            // Use parent of the first input as container
            const parent = fallbackInputs[0].closest('.flex.items-center');
            container = parent ? parent.parentElement : fallbackInputs[0].parentElement;
        } else {
            // No container and no inputs: try to attach to the main form if present
            const formEl = document.querySelector('form');
            if (formEl) {
                container = document.createElement('div');
                container.id = 'dosen-pengampu-container';
                container.innerHTML = `
                    <label class="label">Dosen Pengampu</label>
                    <div class="flex items-center mb-2">
                        <input class="input" name="dosen_pengampu[]" type="text" required>
                        <button type="button" class="ml-2 btn-primary" style="padding:0.5rem 1rem;min-width:2.5rem;" onclick="addDosenPengampu()">+</button>
                    </div>
                `;
                // insert at top of form
                formEl.insertBefore(container, formEl.firstChild);
            } else {
                // Nothing to do
                return;
            }
        }
    }

    // Ambil input terakhir (yang ada tombol +)
    const inputs = container.querySelectorAll('input[name="dosen_pengampu[]"]');
    if (!inputs || inputs.length === 0) {
        // create an initial input so there is something to copy
        const newDiv = document.createElement('div');
        newDiv.className = 'flex items-center mb-2';
        newDiv.innerHTML = `
            <input class="input" name="dosen_pengampu[]" type="text" required>
            <button type="button" class="ml-2 btn-primary" style="padding:0.5rem 1rem;min-width:2.5rem;" onclick="addDosenPengampu()">+</button>
        `;
        container.appendChild(newDiv);
    }

    const lastInput = inputs[0];
    const value = lastInput ? lastInput.value : '';
    if (value.trim() !== "") {
        // Buat input baru di bawah, isi dengan value lama
        const newDiv = document.createElement('div');
        newDiv.className = 'flex items-center mb-2';
        newDiv.innerHTML = `
            <input class="input" name="dosen_pengampu[]" type="text" value="${value}" required>
            <button type="button" class="ml-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded" onclick="removeElementAndSave(this)">-</button>
        `;
        // Insert newDiv SETELAH lastInputDiv
        const lastInputDiv = lastInput.closest('.flex.items-center');
        container.insertBefore(newDiv, lastInputDiv.nextSibling);
        lastInput.value = "";
        saveFormState(); // Save state after adding
    } else {
        lastInput.focus();
    }
}

// Add a new Dosen Pengembang RPS input (used in rps.ejs)
function addDosenPengembangRps() {
    // Try to find a logical container for the dosen_pengembang_rps inputs
    let container = document.getElementById('dosen-pengembang-rps-container');
    if (!container) {
        const fallbackInputs = document.getElementsByName('dosen_pengembang_rps[]');
        if (fallbackInputs && fallbackInputs.length > 0) {
            const parent = fallbackInputs[0].closest('.flex.items-center');
            container = parent ? parent.parentElement : fallbackInputs[0].parentElement;
        } else {
            const formEl = document.querySelector('form');
            if (formEl) {
                container = document.createElement('div');
                container.id = 'dosen-pengembang-rps-container';
                container.innerHTML = `
                    <label class="label">Dosen Pengembang RPS</label>
                    <div class="flex items-center mb-2">
                        <input class="input" name="dosen_pengembang_rps[]" type="text">
                        <button type="button" class="ml-2 btn-primary" style="padding:0.5rem 1rem;min-width:2.5rem;" onclick="addDosenPengembangRps()">+</button>
                    </div>
                `;
                // insert near the top (after dosen-pengampu container if exists)
                const ref = document.getElementById('dosen-pengampu-container');
                if (ref && ref.parentElement) ref.parentElement.insertBefore(container, ref.nextSibling);
                else formEl.insertBefore(container, formEl.firstChild);
            } else {
                return; // nothing to attach to
            }
        }
    }

    const inputs = container.querySelectorAll('input[name="dosen_pengembang_rps[]"]');
    if (!inputs || inputs.length === 0) {
        const newDiv = document.createElement('div');
        newDiv.className = 'flex items-center mb-2';
        newDiv.innerHTML = `
            <input class="input" name="dosen_pengembang_rps[]" type="text">
            <button type="button" class="ml-2 btn-primary" style="padding:0.5rem 1rem;min-width:2.5rem;" onclick="addDosenPengembangRps()">+</button>
        `;
        container.appendChild(newDiv);
    }

    // Use the last input as the insertion point
    const lastInput = inputs[inputs.length - 1] || container.querySelector('input[name="dosen_pengembang_rps[]"]');
    const value = lastInput ? lastInput.value : '';

    // Create a new editable input (do not overwrite the readonly first input)
    const newDiv = document.createElement('div');
    newDiv.className = 'flex items-center mb-2';
    newDiv.innerHTML = `
        <input class="input" name="dosen_pengembang_rps[]" type="text" value=""/>
        <button type="button" class="ml-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded" onclick="removeElementAndSave(this)">-</button>
    `;

    if (lastInput && lastInput.closest) {
        const lastDiv = lastInput.closest('.flex.items-center');
        if (lastDiv && lastDiv.parentElement) lastDiv.parentElement.insertBefore(newDiv, lastDiv.nextSibling);
        else container.appendChild(newDiv);
    } else {
        container.appendChild(newDiv);
    }

    // Focus the newly created input
    const createdInput = newDiv.querySelector('input[name="dosen_pengembang_rps[]"]');
    if (createdInput) createdInput.focus();

    saveFormState();
}

function addPustakaUtama() {
    const container = document.getElementById('pustaka-utama-list');
    const textareas = container.querySelectorAll('textarea[name="pustaka_utama[]"]');
    const lastTextarea = textareas[0];
    const value = lastTextarea.value;
    if (value.trim() !== "") {
        const newDiv = document.createElement('div');
        newDiv.className = 'flex items-start mb-2';
        newDiv.innerHTML = `
            <textarea class="input" name="pustaka_utama[]" rows="2" required>${value}</textarea>
            <button type="button" class="ml-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded" onclick="removeElementAndSave(this)">-</button>
        `;
        // Insert newDiv SETELAH lastInputDiv
        const lastTextAreaDiv = lastTextarea.closest('.flex.items-start');
        container.insertBefore(newDiv, lastTextAreaDiv.nextSibling);
        lastTextarea.value = "";
        saveFormState(); // Save state after adding
    } else {
        lastTextarea.focus();
    }
}

function addPustakaPendukung() {
    const container = document.getElementById('pustaka-pendukung-list');
    const textareas = container.querySelectorAll('textarea[name="pustaka_pendukung[]"]');
    const lastTextarea = textareas[0];
    const value = lastTextarea.value;
    if (value.trim() !== "") {
        const newDiv = document.createElement('div');
        newDiv.className = 'flex items-start mb-2';
        newDiv.innerHTML = `
            <textarea class="input" name="pustaka_pendukung[]" rows="2" required>${value}</textarea>
            <button type="button" class="ml-2 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded" onclick="removeElementAndSave(this)">-</button>
        `;
        const lastTextAreaDiv = lastTextarea.closest('.flex.items-start');
        container.insertBefore(newDiv, lastTextAreaDiv.nextSibling); lastTextarea.value = "";
        saveFormState(); // Save state after adding
    } else {
        lastTextarea.focus();
    }
}

function removeElement(button) {
    button.parentElement.remove();
}

function removeElementAndSave(button) {
    button.parentElement.remove();
    saveFormState(); // Save state after removing
}

function removeSubCPMKAndSave(subCpmkDiv) {
    console.log('Removing Sub-CPMK:', subCpmkDiv);
    subCpmkDiv.remove();
    saveFormState(); // Save state after removing
}


document.addEventListener('DOMContentLoaded', () => {
    const cplCheckboxes = document.querySelectorAll('input[name="cpl[]"]');
    const cpmkContainer = document.getElementById('cpmk-container');
    const subCpmkContainer = document.getElementById('sub-cpmk-container');

    cplCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const cplValue = checkbox.value;
            const cplDescription = checkbox.getAttribute('data-description');
            const cpmkSectionId = `cpmk-section-${cplValue}`;

            if (checkbox.checked) {
                // Cegah duplikasi section
                if (!document.getElementById(cpmkSectionId)) {
                    const newCpmkSection = document.createElement('div');
                    newCpmkSection.id = cpmkSectionId;
                    newCpmkSection.className = 'mb-4 p-4 border rounded';
                    newCpmkSection.innerHTML = `
                            <div class="flex justify-between items-center">
                                <h3 class="text-lg font-semibold">${cplValue}: ${cplDescription}</h3>
                                <button type="button" class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded" onclick="addCPMK('${cplValue}', '${cplDescription}')">Add CPMK</button>
                            </div>
                            <div id="cpmk-list-${cplValue}"></div>
                        `;
                    cpmkContainer.appendChild(newCpmkSection);
                }
            } else {
                const cpmkSection = document.getElementById(cpmkSectionId);
                if (cpmkSection) {
                    cpmkSection.remove();
                }
                const subCpmkSections = subCpmkContainer.querySelectorAll(`[data-cpl="${cplValue}"]`);
                subCpmkSections.forEach(section => section.remove());
            }
            // saveFormState(); // HAPUS agar restore tidak menimpa localStorage
        });
    });

    // Restore state if available - but don't save immediately after
    window._initializing = true;
    restoreFormState();

    // Clear the initialization flag after restoration is complete
    setTimeout(() => {
        window._initializing = false;
    }, 2000);

    // Add event listeners to save state when input values change
    document.addEventListener('input', function (e) {
        // Skip if initializing
        if (window._initializing) return;

        if (e.target && e.target.matches &&
            (e.target.matches('input[name="dosen_pengampu[]"], input[name="pustaka_utama[]"], input[name="pustaka_pendukung[]"]') ||
                e.target.matches('input[name^="sub_cpmk["], textarea[name^="sub_cpmk["], input[name^="cpmk["], textarea[name^="cpmk["]') ||
                e.target.matches('input, textarea, select'))) {
            // Debounce to avoid too frequent saves
            clearTimeout(window.saveStateTimeout);
            window.saveStateTimeout = setTimeout(() => {
                try {
                    saveFormState();
                } catch (error) {
                    // Silent fail
                }
            }, 1000); // Increased timeout for better UX
        }
    });

    // Also save state when any form input changes (blur event)
    document.addEventListener('blur', function (e) {
        // Skip if initializing
        if (window._initializing) return;

        if (e.target && e.target.matches &&
            (e.target.matches('input[name^="sub_cpmk["], textarea[name^="sub_cpmk["], input[name^="cpmk["], textarea[name^="cpmk["]') ||
                e.target.matches('input, textarea, select'))) {
            try {
                saveFormState();
            } catch (error) {
                // Silent fail
            }
        }
    }, true);

    // Save state on any change event as well
    document.addEventListener('change', function (e) {
        // Skip if initializing
        if (window._initializing) return;

        if (e.target && e.target.matches && e.target.matches('input, select, textarea')) {
            try {
                saveFormState();
            } catch (error) {
                // Silent fail
            }
        }
    });

    // Periodic auto-save every 30 seconds for extra safety
    setInterval(() => {
        // Skip if initializing
        if (window._initializing) return;

        try {
            saveFormState();
        } catch (error) {
            // Silent fail
        }
    }, 30000);

    // Save state before page unload
    window.addEventListener('beforeunload', function (e) {
        try {
            saveFormState();
        } catch (error) {
            // Silent fail
        }
    });
    // Handle form submission for NEW RPS only (not edit)
    const rpsForm = document.getElementById('rps-form');
    if (rpsForm && rpsForm.action.includes('/save-rps')) {
        rpsForm.addEventListener('submit', function (e) {
            // Run final Step 5 validation; if it returns false, block submission
            try {
                const ok = (typeof validateStep5AndNext === 'function') ? validateStep5AndNext() : true;
                if (!ok) {
                    // Validation failed; prevent submit and don't show saving UI
                    e.preventDefault();
                    return;
                }
                // Run modalitas/metode validation
                if (typeof validateModalitasForAll === 'function') {
                    const vm = validateModalitasForAll();
                    if (!vm.ok) {
                        e.preventDefault();
                        alert(vm.message);
                        return;
                    }
                }
                if (!window.validateBobotInputs(rpsForm)) {
                    e.preventDefault();
                    return;
                }
            } catch (err) {
                // If validator throws, block submission and surface error
                e.preventDefault();
                alert('Terjadi kesalahan saat memvalidasi form. Periksa kembali input Anda.');
                return;
            }

            e.preventDefault(); // Prevent default form submission

            syncCplDescriptionsForSubmit(rpsForm);

            // Show saving indicator
            showAutoSaveIndicator();

            // Create FormData from the form and convert to URLSearchParams for proper form submission
            const formData = new FormData(rpsForm);
            const urlParams = new URLSearchParams();

            // Convert FormData to URLSearchParams to match expected server format
            for (let [key, value] of formData.entries()) {
                urlParams.append(key, value);
            }

            // Submit via fetch with proper content type
            fetch('/save-rps', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: urlParams
            })
                .then(response => {
                    if (response.redirected || response.url.includes('/login')) {
                        window.location.href = '/login';
                        return null;
                    }
                    return response.json();
                })
                .then(data => {
                    if (!data) return;
                    if (data.success) {
                        // Remove auto-save indicator and show small success indicator
                        showSaveSuccess();

                        // Clear localStorage after successful save
                        clearFormStorage();

                        // Show success message (larger toast)
                        const successIndicator = document.createElement('div');
                        successIndicator.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
                        successIndicator.innerHTML = `
                            <div class="flex items-center">
                                <i class="fas fa-check-circle mr-2"></i>
                                <div>
                                    <div class="font-semibold">${data.message}</div>
                                    <div class="text-sm opacity-90">ID: ${data.id}</div>
                                </div>
                            </div>
                        `;
                        document.body.appendChild(successIndicator);

                        // Auto-remove success message after 5 seconds
                        setTimeout(() => {
                            if (successIndicator && successIndicator.parentNode) {
                                successIndicator.remove();
                            }
                        }, 5000);

                        // Reset form after successful save
                        rpsForm.reset();

                        // Reset to step 1
                        currentStep = 1;
                        showStep(currentStep);

                        // Clear all dynamic content
                        document.getElementById('cpmk-container').innerHTML = '';
                        document.getElementById('sub-cpmk-container').innerHTML = '';

                        // Reset dynamic field containers
                        resetDynamicFields();
                        // After everything is cleared and user saw the success message, redirect to dashboard (/history)
                        setTimeout(() => {
                            // Final redirect to dashboard/history
                            window.location.href = '/history';
                        }, 1200); // short delay to allow user to see the toast

                    } else {
                        throw new Error(data.message || 'Gagal menyimpan RPS');
                    }
                })
                .catch(error => {
                    // Remove auto-save indicator and show small error indicator
                    showSaveError();

                    // Show error message
                    const errorIndicator = document.createElement('div');
                    errorIndicator.className = 'fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
                    errorIndicator.innerHTML = `
                        <div class="flex items-center">
                            <i class="fas fa-exclamation-triangle mr-2"></i>
                            <div>
                                <div class="font-semibold">Gagal menyimpan RPS</div>
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

// Function to reset dynamic fields to initial state
function resetDynamicFields() {
    // Reset dosen pengampu
    const dosenContainer = document.getElementById('dosen-pengampu-container');
    if (dosenContainer) {
        const inputs = dosenContainer.querySelectorAll('input[name="dosen_pengampu[]"]');
        for (let i = 1; i < inputs.length; i++) {
            inputs[i].parentElement.remove();
        }
        if (inputs[0]) inputs[0].value = '';
    }

    // Reset pustaka utama
    const pustakaUtamaContainer = document.getElementById('pustaka-utama-list');
    if (pustakaUtamaContainer) {
        const textareas = pustakaUtamaContainer.querySelectorAll('textarea[name="pustaka_utama[]"]');
        for (let i = 1; i < textareas.length; i++) {
            textareas[i].parentElement.remove();
        }
        if (textareas[0]) textareas[0].value = '';
    }

    // Reset pustaka pendukung
    const pustakaPendukungContainer = document.getElementById('pustaka-pendukung-list');
    if (pustakaPendukungContainer) {
        const textareas = pustakaPendukungContainer.querySelectorAll('textarea[name="pustaka_pendukung[]"]');
        for (let i = 1; i < textareas.length; i++) {
            textareas[i].parentElement.remove();
        }
        if (textareas[0]) textareas[0].value = '';
    }

    // Uncheck all CPL checkboxes
    document.querySelectorAll('input[name="cpl[]"]').forEach(cb => {
        cb.checked = false;
    });
}

function addCPMK(cplValue, cplDescription, cpmkId = null, deskripsi = '') {

    const cpmkList = document.getElementById(`cpmk-list-${cplValue}`);
    // Jika cpmkId sudah diberikan (restore), gunakan itu, jangan generate baru
    if (!cpmkId) {
        // Generate CPMK ID baru hanya jika user klik Add CPMK
        let nextNum = 1;
        while (document.getElementById(`CPMK${String(nextNum).padStart(2, '0')}`)) {
            nextNum++;
        }
        cpmkId = `CPMK${String(nextNum).padStart(2, '0')}`;
    }
    // Jangan duplikat jika sudah ada
    if (document.getElementById(cpmkId)) return;

    const newCpmkDiv = document.createElement('div');
    newCpmkDiv.id = cpmkId;
    newCpmkDiv.className = 'mt-2 p-2 border-l-4 border-blue-500';
    newCpmkDiv.innerHTML = `
        <div class="flex justify-between items-center">
            <label class="block text-gray-700 text-sm font-bold mb-2" for="deskripsi_cpmk_${cpmkId}">${cpmkId}</label>
            <button type="button" class="text-red-500 font-bold" onclick="removeCPMK('${cpmkId}', '${cplValue}')">Remove CPMK</button>
        </div>
        <div id="${cpmkId}-content">
            <input type="hidden" name="cpmk[${cpmkId}][cpl_code]" value="${cplValue}">
            <input type="hidden" name="cpmk[${cpmkId}][cpl_description]" value="${cplDescription}">
            <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" name="cpmk[${cpmkId}][deskripsi]" rows="2" required></textarea>
        </div>
    `;
    cpmkList.appendChild(newCpmkDiv);
    // Set deskripsi jika ada (untuk restore)
    if (deskripsi) {
        newCpmkDiv.querySelector('textarea[name^="cpmk["]').value = deskripsi;
    }

    const subCpmkContainer = document.getElementById('sub-cpmk-container');
    const newSubCpmkSection = document.createElement('div');
    newSubCpmkSection.id = `sub-cpmk-section-${cpmkId}`;
    newSubCpmkSection.setAttribute('data-cpl', cplValue);
    newSubCpmkSection.className = 'mb-4 p-4 border rounded';
    newSubCpmkSection.innerHTML = `
        <div class="flex justify-between items-center">
            <h3 class="text-lg font-semibold cursor-pointer" style="cursor:pointer;" onclick="toggleCollapse('sub-cpmk-list-${cpmkId}', this)">Sub-CPMK for ${cpmkId}</h3>
            <button type="button" class="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded" onclick="addSubCPMK('${cpmkId}')">Add Sub-CPMK</button>
        </div>
        <div id="sub-cpmk-list-${cpmkId}"></div>
    `;
    subCpmkContainer.appendChild(newSubCpmkSection);
    saveFormState();
}

// Collapse/Expand logic
function toggleCollapse(contentId, headerEl) {
    const content = document.getElementById(contentId);
    if (!content) return;
    if (content.style.display === 'none') {
        content.style.display = '';
        if (headerEl) headerEl.classList.remove('text-gray-400');
    } else {
        content.style.display = 'none';
        if (headerEl) headerEl.classList.add('text-gray-400');
    }
}

// Enhanced collapse/expand for subCPMK in view mode
function toggleSubCpmkCollapse(contentId, headerEl) {
    const content = document.getElementById(contentId);
    const icon = headerEl.querySelector('.collapse-icon');

    if (!content || !icon) return;

    if (content.classList.contains('collapsed')) {
        // Expand
        content.classList.remove('collapsed');
        content.classList.add('expanding');
        icon.classList.remove('collapsed');
        headerEl.setAttribute('aria-expanded', 'true');

        // Remove animation class after animation completes
        setTimeout(() => {
            content.classList.remove('expanding');
        }, 300);
    } else {
        // Collapse
        content.classList.add('collapsing');
        icon.classList.add('collapsed');
        headerEl.setAttribute('aria-expanded', 'false');

        // Add collapsed class after animation
        setTimeout(() => {
            content.classList.remove('collapsing');
            content.classList.add('collapsed');
        }, 300);
    }
}

// Enhanced collapse/expand for subCPMK in edit mode
function toggleEditSubCpmkCollapse(contentId, headerEl) {
    const content = document.getElementById(contentId);
    const icon = headerEl.querySelector('.collapse-icon');

    if (!content || !icon) return;

    if (content.classList.contains('collapsed')) {
        // Expand
        content.classList.remove('collapsed');
        content.classList.add('expanding');
        icon.classList.remove('collapsed');
        headerEl.setAttribute('aria-expanded', 'true');

        // Remove animation class after animation completes
        setTimeout(() => {
            content.classList.remove('expanding');
        }, 300);
    } else {
        // Collapse
        content.classList.add('collapsing');
        icon.classList.add('collapsed');
        headerEl.setAttribute('aria-expanded', 'false');

        // Add collapsed class after animation
        setTimeout(() => {
            content.classList.remove('collapsing');
            content.classList.add('collapsed');
        }, 300);
    }
}

// Toggle all subCPMK sections (utility function)
function toggleAllSubCpmk(expand = true) {
    const allContents = document.querySelectorAll('.subcpmk-content, .sub-cpmk-content');
    const allIcons = document.querySelectorAll('.collapse-icon');

    allContents.forEach(content => {
        if (expand) {
            content.classList.remove('collapsed', 'collapsing');
            content.classList.add('expanding');
            setTimeout(() => {
                content.classList.remove('expanding');
            }, 300);
        } else {
            content.classList.add('collapsing');
            setTimeout(() => {
                content.classList.remove('collapsing');
                content.classList.add('collapsed');
            }, 300);
        }
    });

    allIcons.forEach(icon => {
        const header = icon.closest('[role="button"]');
        if (expand) {
            icon.classList.remove('collapsed');
            if (header) header.setAttribute('aria-expanded', 'true');
        } else {
            icon.classList.add('collapsed');
            if (header) header.setAttribute('aria-expanded', 'false');
        }
    });
}

// Individual collapse/expand for each subCPMK form
function toggleIndividualSubCpmkCollapse(contentId, headerEl) {
    const content = document.getElementById(contentId);
    const icon = headerEl.querySelector('.collapse-icon');

    if (!content || !icon) return;

    if (content.classList.contains('collapsed')) {
        // Expand
        content.classList.remove('collapsed');
        content.classList.add('expanding');
        icon.classList.remove('collapsed');
        headerEl.setAttribute('aria-expanded', 'true');

        // Remove animation class after animation completes
        setTimeout(() => {
            content.classList.remove('expanding');
        }, 300);
    } else {
        // Collapse
        content.classList.add('collapsing');
        icon.classList.add('collapsed');
        headerEl.setAttribute('aria-expanded', 'false');

        // Add collapsed class after animation
        setTimeout(() => {
            content.classList.remove('collapsing');
            content.classList.add('collapsed');
        }, 300);
    }
}

function removeCPMK(cpmkId, cplValue) {
    const cpmkDiv = document.getElementById(cpmkId);
    if (cpmkDiv) {
        cpmkDiv.remove();
    }
    const subCpmkSection = document.getElementById(`sub-cpmk-section-${cpmkId}`);
    if (subCpmkSection) {
        subCpmkSection.remove();
    }
    saveFormState();
}


function addSubCPMK(cpmkId, predefinedIndex = null) {
    const subCpmkList = document.getElementById(`sub-cpmk-list-${cpmkId}`);
    if (!subCpmkList) {
        alert('Gagal menambah Sub-CPMK: container tidak ditemukan. Silakan refresh halaman atau pastikan CPMK sudah ditambahkan.');
        return;
    }

    // Cari index terkecil yang belum dipakai atau gunakan predefined index
    let nextIndex;
    if (predefinedIndex !== null) {
        nextIndex = predefinedIndex;
        // Check if this index already exists
        const existingDiv = subCpmkList.querySelector(`[data-subcpmk-index="${nextIndex}"]`);
        if (existingDiv) {
            return;
        }
    } else {
        let usedIndexes = Array.from(subCpmkList.querySelectorAll('[data-subcpmk-index]')).map(e => parseInt(e.getAttribute('data-subcpmk-index')));
        nextIndex = 1;
        while (usedIndexes.includes(nextIndex)) {
            nextIndex++;
        }
    }


    const newSubCpmkDiv = document.createElement('div');
    newSubCpmkDiv.className = 'mt-2 border border-gray-300 rounded-lg overflow-hidden';
    newSubCpmkDiv.setAttribute('data-subcpmk-index', nextIndex);

    const uniqueId = `${cpmkId}-${nextIndex}`;

    newSubCpmkDiv.innerHTML = `
        <div class="bg-gray-50 p-3 border-b border-gray-200">
            <div class="flex justify-between items-center">
                <h5 class="font-semibold text-md cursor-pointer flex items-center"
                    onclick="toggleIndividualSubCpmkCollapse('subcpmk-form-content-${uniqueId}', this)"
                    onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleIndividualSubCpmkCollapse('subcpmk-form-content-${uniqueId}', this); }"
                    tabindex="0"
                    role="button"
                    aria-expanded="true"
                    aria-controls="subcpmk-form-content-${uniqueId}">
                    <span class="collapse-icon mr-2">▼</span>
                    Sub-CPMK #${nextIndex} untuk ${cpmkId}
                </h5>
                <button type="button" class="text-red-500 font-bold hover:text-red-700" onclick="removeSubCPMKAndSave(this.closest('[data-subcpmk-index]'))">
                    Remove
                </button>
            </div>
        </div>
        <div id="subcpmk-form-content-${uniqueId}" class="subcpmk-form-content p-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Deskripsi Sub-CPMK</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][deskripsi]" rows="2" required></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Pekan ke-</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="number" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][pekan_awal]" min="1" required placeholder="Awal">
                        <span>-</span>
                        <input type="number" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][pekan_akhir]" min="1" required placeholder="Akhir">
                    </div>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Materi Pembelajaran</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][materi]" rows="2" required></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Durasi Waktu Pembelajaran (menit)</label>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="number" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][durasi]" min="1" required placeholder="Durasi (menit)">
                    </div>
                </div>
                <div class="md:col-span-2">
                    <label class="block text-gray-700 text-sm font-bold mb-2">Modalitas (Pilih minimal satu)</label>
                    <div class="mb-3">
                        <div class="flex items-center space-x-6 mb-2">
                            <label class="flex items-center">
                                <input id="modalitas-checkbox-luring-${uniqueId}" type="checkbox" name="sub_cpmk[${cpmkId}][${nextIndex}][modalitas][]" value="luring" class="modalitas-checkbox mr-2" onchange="toggleModalitasInput('${cpmkId}', '${nextIndex}')">
                                <span class="text-sm font-medium">Luring (Offline)</span>
                            </label>
                            <label class="flex items-center">
                                <input id="modalitas-checkbox-daring-${uniqueId}" type="checkbox" name="sub_cpmk[${cpmkId}][${nextIndex}][modalitas][]" value="daring" class="modalitas-checkbox mr-2" onchange="toggleModalitasInput('${cpmkId}', '${nextIndex}')">
                                <span class="text-sm font-medium">Daring (Online)</span>
                            </label>
                        </div>
                    </div>
                    <!-- Use these fields to capture Metode Pembelajaran for each modalitas (avoid duplicate fields) -->
                    <div id="metode-luring-${cpmkId}-${nextIndex}" class="modalitas-input hidden">
                        <label class="block text-gray-600 text-xs font-bold mb-1">Metode Pembelajaran Luring:</label>
                        <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][metode_luring]" rows="2" placeholder="Contoh: Ceramah, Praktikum, Diskusi"></textarea>
                    </div>
                    <div id="metode-daring-${cpmkId}-${nextIndex}" class="modalitas-input hidden">
                        <label class="block text-gray-600 text-xs font-bold mb-1">Metode Pembelajaran Daring:</label>
                        <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][metode_daring]" rows="2" placeholder="Contoh: Webinar, E-Learning, Diskusi Online"></textarea>
                    </div>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Bentuk Pembelajaran</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][bentuk_pembelajaran]" rows="2" placeholder="Contoh: Praktikum, Diskusi, dll"></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Strategi Pembelajaran</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][strategi_pembelajaran]" rows="2" placeholder="Contoh: Kolaboratif, Mandiri, dll" required></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Media</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][media]" rows="2" placeholder="Contoh: PPT, Video, dll"></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Sumber Belajar</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][sumber_belajar]" rows="2" placeholder="Contoh: Buku, Jurnal, dll"></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Alat dan Bahan</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][alat_bahan]" rows="2" placeholder="Contoh: Laptop, Proyektor, Papan tulis, Modul, dll"></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Pengalaman Belajar</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][pengalaman_belajar]" rows="2" placeholder="Contoh: Ceramah, diskusi, studi kasus, tanya jawab"></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Teknik & Kriteria Penilaian</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][teknik_kriteria]" rows="2" required></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Bentuk Penilaian</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][bentuk_penilaian]" rows="2"></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Indikator Penilaian</label>
                    <textarea class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][indikator]" rows="2" required></textarea>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">Bobot Penilaian (%)</label>
                    <input type="text" inputmode="decimal" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 bobot-input" name="sub_cpmk[${cpmkId}][${nextIndex}][bobot]" required>
                </div>
                <div class="md:col-span-2 border rounded p-3 bg-gray-50">
                    <label class="block text-gray-700 text-sm font-bold mb-2">Bentuk Asesmen</label>
                    <div class="mb-3">
                        <p class="text-xs font-semibold text-gray-600 mb-1">Formatif</p>
                        <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700" name="sub_cpmk[${cpmkId}][${nextIndex}][formatif_nama]" placeholder="Nama asesmen, contoh: Partisipasi dan Tanya jawab">
                    </div>
                    <div>
                        <p class="text-xs font-semibold text-gray-600 mb-1">Sumatif</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                            <div>
                                <label class="block text-gray-600 text-xs mb-1">Kuis</label>
                                <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-1" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_kuis_nama]" placeholder="Nama, contoh: Kuis 1">
                                <input type="text" inputmode="decimal" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 bobot-input" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_kuis_bobot]" placeholder="Bobot (%)">
                            </div>
                            <div>
                                <label class="block text-gray-600 text-xs mb-1">Tugas</label>
                                <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-1" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_tugas_nama]" placeholder="Nama, contoh: Laporan Singkat 1">
                                <input type="text" inputmode="decimal" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 bobot-input" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_tugas_bobot]" placeholder="Bobot (%)">
                            </div>
                            <div>
                                <label class="block text-gray-600 text-xs mb-1">Ujian</label>
                                <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-1" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_ujian_nama]" placeholder="Nama, contoh: UTS">
                                <input type="text" inputmode="decimal" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 bobot-input" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_ujian_bobot]" placeholder="Bobot (%)">
                            </div>
                            <div>
                                <label class="block text-gray-600 text-xs mb-1">PjBL</label>
                                <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-1" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_pjbl_nama]" placeholder="Nama, contoh: PjBL 1">
                                <input type="text" inputmode="decimal" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 bobot-input" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_pjbl_bobot]" placeholder="Bobot (%)">
                            </div>
                            <div>
                                <label class="block text-gray-600 text-xs mb-1">Presentasi</label>
                                <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-1" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_presentasi_nama]" placeholder="Nama, contoh: Presentasi 1">
                                <input type="text" inputmode="decimal" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 bobot-input" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_presentasi_bobot]" placeholder="Bobot (%)">
                            </div>
                        </div>
                        <div class="lainnya-wrapper mt-3">
                            <p class="text-xs font-semibold text-gray-600 mb-1">Lainnya</p>
                            <div class="lainnya-list"></div>
                            <button type="button" class="text-xs text-blue-600 hover:underline mt-1" onclick="window.addLainnyaRow(this)">+ Tambah Lainnya</button>
                            <input type="hidden" class="lainnya-json" name="sub_cpmk[${cpmkId}][${nextIndex}][sumatif_lainnya]" value="[]">
                        </div>
                    </div>
                </div>
                <div>
                    <label class="block text-gray-700 text-sm font-bold mb-2">CPL yang Tercakup</label>
                    <div id="cpl-tercakup-${uniqueId}" class="flex flex-col space-y-1 text-sm text-gray-700">
                        <!-- Checkbox list will be populated from selected CPLs in Step 3 -->
                    </div>
                </div>
            </div>
        </div>
    `;
    subCpmkList.appendChild(newSubCpmkDiv);

    // Populate CPL checkboxes for this Sub-CPMK using CPLs selected in Step 3
    (function populateCplTercakup() {
        try {
            const cplContainer = newSubCpmkDiv.querySelector(`#cpl-tercakup-${uniqueId}`);
            if (!cplContainer) return;

            // Find all CPL checkboxes selected in Step 3
            const selected = Array.from(document.querySelectorAll('input[name="cpl[]"]:checked'))
                .map(cb => ({ code: cb.value, desc: cb.getAttribute('data-description') }));

            if (selected.length === 0) {
                cplContainer.innerHTML = '<div class="text-sm text-gray-500">(Tidak ada CPL dipilih di Step 3)</div>';
                return;
            }

            // Build checkbox list; name uses array so multiple can be selected
            const inputName = `sub_cpmk[${cpmkId}][${nextIndex}][cpl][]`;
            selected.forEach(cpl => {
                const wrap = document.createElement('label');
                wrap.className = 'flex items-center space-x-2';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.name = inputName;
                checkbox.value = cpl.code;
                checkbox.className = 'mr-2';
                const span = document.createElement('span');
                span.textContent = `${cpl.code}`;
                wrap.appendChild(checkbox);
                wrap.appendChild(span);
                cplContainer.appendChild(wrap);
            });
        } catch (err) {
            // silent
            console.error('populateCplTercakup error', err);
        }
    })();

    // Add event listeners to the newly created inputs for immediate save
    newSubCpmkDiv.querySelectorAll('input, textarea').forEach(input => {
        input.addEventListener('input', function () {
            // Skip if initializing
            if (window._initializing) return;

            clearTimeout(window.saveStateTimeout);
            window.saveStateTimeout = setTimeout(() => {
                saveFormState();
            }, 1000); // Increased timeout to reduce frequent saves
        });

        input.addEventListener('blur', function () {
            // Skip if initializing
            if (window._initializing) return;

            saveFormState();
        });

        // Additional event for immediate save on significant changes
        input.addEventListener('change', function () {
            // Skip if initializing
            if (window._initializing) return;

            saveFormState();
        });
    });

    // Don't save during restoration to avoid overwriting
    if (!window._restoringSubCPMK) {
        saveFormState();
    }
    // Expose addSubCPMK globally so edit page can call it via onclick handlers
    // This single exposure prevents duplicate inner function definitions and ensures availability
    // (actual toggleModalitasInput and validateModalitasForAll live at module scope above)
    if (typeof addSubCPMK === 'function') {
        window.addSubCPMK = addSubCPMK;
    }
}
