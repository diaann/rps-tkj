// Validasi real-time untuk field wajib (required) di semua form, KECUALI form
// yang ditandai data-no-realtime-validation (dipakai di form isi nilai Penilaian).
// Pesan muncul sbg teks kecil di bawah field begitu user mulai mengetik/blur --
// beda dari window.showFieldWarning (toast, cuma jalan pas submit/Next).
if (!window.__realtimeValidationInstalled) {
    window.__realtimeValidationInstalled = true;

    const messageElFor = new WeakMap();
    const groupMessageElFor = new WeakMap();
    const boundFields = new WeakSet();
    const boundGroups = new WeakSet();

    function messageForField(field) {
        if (field.classList.contains('bobot-input')) {
            if (field.hasAttribute('required') && !field.value.trim()) return 'Wajib diisi';
            if (field.value.trim() && typeof window.isValidBobotValue === 'function' && !window.isValidBobotValue(field.value)) {
                return 'Harus berupa angka 0-100 (boleh pakai koma, mis. 4,5)';
            }
            return '';
        }

        const v = field.validity;
        if (v.valid) return '';
        if (v.valueMissing) {
            if (field.tagName === 'SELECT') return 'Wajib dipilih';
            if (field.type === 'file') return 'Wajib memilih file';
            if (field.type === 'checkbox' || field.type === 'radio') return 'Wajib dipilih';
            return 'Wajib diisi';
        }
        if (v.typeMismatch) return field.type === 'email' ? 'Format email tidak valid' : 'Format tidak valid';
        if (v.rangeUnderflow) return `Nilai minimal ${field.min}`;
        if (v.rangeOverflow) return `Nilai maksimal ${field.max}`;
        if (v.tooShort) return `Minimal ${field.minLength} karakter`;
        if (v.tooLong) return `Maksimal ${field.maxLength} karakter`;
        if (v.patternMismatch) return 'Format tidak sesuai';
        if (v.badInput) return 'Masukkan angka yang valid';
        return field.validationMessage || 'Input tidak valid';
    }

    // Cari titik penyisipan pesan: naik lewat wrapper flex/inline-flex terdekat
    // biar ga numpuk di tengah baris (mis. baris pekan_awal/pekan_akhir yg flex),
    // tapi ga pernah lewat batas <form>.
    function resolveAnchor(field) {
        const form = field.closest('form');
        let el = field;
        while (el.parentElement && el !== form) {
            const display = window.getComputedStyle(el.parentElement).display;
            if (display === 'flex' || display === 'inline-flex') {
                el = el.parentElement;
                continue;
            }
            break;
        }
        return el;
    }

    function getOrCreateMessageEl(field) {
        let el = messageElFor.get(field);
        if (el && el.isConnected) return el;
        el = document.createElement('p');
        el.className = 'field-error-message text-xs text-red-600 mt-1';
        el.setAttribute('role', 'alert');
        el.style.display = 'none';
        const anchor = resolveAnchor(field);
        anchor.insertAdjacentElement('afterend', el);
        messageElFor.set(field, el);
        return el;
    }

    function renderField(field) {
        const msg = messageForField(field);
        const el = getOrCreateMessageEl(field);
        if (msg) {
            el.textContent = msg;
            el.style.display = 'block';
            field.classList.add('ring-2', 'ring-red-400');
        } else {
            el.textContent = '';
            el.style.display = 'none';
            field.classList.remove('ring-2', 'ring-red-400');
        }
    }

    function touchAndRender(field) {
        field.__rtTouched = true;
        renderField(field);
    }

    function bindField(field) {
        if (boundFields.has(field)) return;
        boundFields.add(field);
        const handler = function() {
            if (!field.__rtTouched) return;
            renderField(field);
        };
        field.addEventListener('input', handler);
        field.addEventListener('change', handler);
        field.addEventListener('blur', function() { touchAndRender(field); });
    }

    function groupMessage(container, checkedCount) {
        const min = parseInt(container.getAttribute('data-require-group-min'), 10) || 1;
        if (checkedCount >= min) return '';
        const label = container.getAttribute('data-require-group-label') || 'pilihan';
        return min === 1 ? `Pilih minimal 1 ${label}` : `Pilih minimal ${min} ${label}`;
    }

    function getOrCreateGroupMessageEl(container) {
        let el = groupMessageElFor.get(container);
        if (el && el.isConnected) return el;
        el = document.createElement('p');
        el.className = 'field-error-message text-xs text-red-600 mt-1';
        el.setAttribute('role', 'alert');
        el.style.display = 'none';
        container.appendChild(el);
        groupMessageElFor.set(container, el);
        return el;
    }

    function renderGroup(container) {
        const checkedCount = container.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked').length;
        const msg = groupMessage(container, checkedCount);
        const el = getOrCreateGroupMessageEl(container);
        if (msg) {
            el.textContent = msg;
            el.style.display = 'block';
        } else {
            el.textContent = '';
            el.style.display = 'none';
        }
    }

    function bindGroup(container) {
        if (boundGroups.has(container)) return;
        boundGroups.add(container);
        container.addEventListener('change', function(e) {
            if (!e.target || (e.target.type !== 'checkbox' && e.target.type !== 'radio')) return;
            container.__rtTouched = true;
            renderGroup(container);
        });
    }

    function isExcluded(field) {
        return !!field.closest('form[data-no-realtime-validation]');
    }

    window.initRealtimeValidation = function(scopeEl) {
        const scope = scopeEl || document;

        const fields = scope.matches && scope.matches('input[required]:not([type="file"]), select[required], textarea[required], .bobot-input[required]')
            ? [scope]
            : Array.from(scope.querySelectorAll('input[required]:not([type="file"]), select[required], textarea[required], .bobot-input[required]'));

        fields.forEach(function(field) {
            if (isExcluded(field)) return;
            bindField(field);
        });

        const groups = scope.matches && scope.matches('[data-require-group]')
            ? [scope]
            : Array.from(scope.querySelectorAll('[data-require-group]'));

        groups.forEach(function(group) {
            if (group.closest('form[data-no-realtime-validation]')) return;
            bindGroup(group);
        });
    };

    document.addEventListener('DOMContentLoaded', function() {
        window.initRealtimeValidation(document);

        document.querySelectorAll('form:not([data-no-realtime-validation])').forEach(function(form) {
            form.addEventListener('submit', function() {
                form.querySelectorAll('input[required]:not([type="file"]), select[required], textarea[required], .bobot-input[required]').forEach(touchAndRender);
                form.querySelectorAll('[data-require-group]').forEach(function(group) {
                    group.__rtTouched = true;
                    renderGroup(group);
                });
            }, true);
        });
    });
}
