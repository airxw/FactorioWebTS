var modalStack = [];
var escBound = false;
var previousActiveElement = null;

function lockBodyScroll() {
    document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
    if (modalStack.length === 0) {
        document.body.style.overflow = '';
    }
}

function handleEscKey(e) {
    if (e.key === 'Escape' && modalStack.length > 0) {
        var top = modalStack[modalStack.length - 1];
        if (top && top.closeModal) {
            top.closeModal();
        }
    }
}

function ensureEscListener() {
    if (!escBound) {
        escBound = true;
        document.addEventListener('keydown', handleEscKey);
    }
}

function pushModal(modalRef) {
    previousActiveElement = document.activeElement;
    modalStack.push(modalRef);
    lockBodyScroll();
    ensureEscListener();
}

function popModal(modalRef) {
    var idx = modalStack.indexOf(modalRef);
    if (idx >= 0) {
        modalStack.splice(idx, 1);
    }
    unlockBodyScroll();
    if (modalStack.length === 0 && previousActiveElement) {
        try { previousActiveElement.focus(); } catch (e) {}
        previousActiveElement = null;
    }
}

function animateOut(overlay, modal, onDone) {
    overlay.style.animation = 'fadeOut 0.2s ease forwards';
    modal.style.animation = 'scaleOut 0.2s ease forwards';
    setTimeout(function () {
        onDone();
    }, 200);
}

function trapFocus(container) {
    var focusable = container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    container.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });
}

function makeFooterButtons(confirmText, cancelText, danger, onConfirm, onCancel, closeFn) {
    var footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid var(--color-border, #e0e0e0);';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline-secondary';
    cancelBtn.textContent = cancelText;
    cancelBtn.onclick = function () {
        closeFn();
        onCancel();
    };
    footer.appendChild(cancelBtn);

    var confirmBtn = document.createElement('button');
    confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    confirmBtn.textContent = confirmText;
    confirmBtn.onclick = async function () {
        closeFn();
        await onConfirm();
    };
    footer.appendChild(confirmBtn);

    return footer;
}

function makeAriaId() {
    return 'modal-' + Math.random().toString(36).slice(2, 9);
}

function showModal(options) {
    options = options || {};
    var title = options.title || '确认';
    var content = options.content || '';
    var confirmText = options.confirmText || '确认';
    var cancelText = options.cancelText || '取消';
    var onConfirm = options.onConfirm || function () {};
    var onCancel = options.onCancel || function () {};
    var danger = options.danger || false;

    var ariaId = makeAriaId();
    var titleId = ariaId + '-title';
    var bodyId = ariaId + '-body';

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', titleId);
    overlay.setAttribute('aria-describedby', bodyId);

    var modal = document.createElement('div');
    modal.className = 'modal-box';

    var header = document.createElement('div');
    header.className = 'modal-box-header';

    var titleEl = document.createElement('h3');
    titleEl.id = titleId;
    titleEl.textContent = title;
    header.appendChild(titleEl);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'modal-box-close';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = function () {
        closeModal();
        onCancel();
    };
    header.appendChild(closeBtn);

    modal.appendChild(header);

    var body = document.createElement('div');
    body.className = 'modal-box-body';
    body.id = bodyId;
    body.innerHTML = content;
    modal.appendChild(body);

    var footer = makeFooterButtons(confirmText, cancelText, danger, onConfirm, onCancel, closeModal);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
        overlay.classList.add('show');
        trapFocus(modal);
        var confirmBtn = footer.querySelector('.btn-primary, .btn-danger');
        if (confirmBtn) confirmBtn.focus();
    });

    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
            closeModal();
            onCancel();
        }
    });

    var modalRef = { overlay: overlay, closeModal: closeModal };
    pushModal(modalRef);

    function closeModal() {
        if (closeModal._called) return;
        closeModal._called = true;

        animateOut(overlay, modal, function () {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            popModal(modalRef);
        });
    }

    return modalRef;
}

function showPrompt(options) {
    options = options || {};
    var title = options.title || '请输入';
    var content = options.content || '';
    var placeholder = options.placeholder || '';
    var confirmText = options.confirmText || '确定';
    var cancelText = options.cancelText || '取消';
    var onConfirm = options.onConfirm || function (value) {};
    var onCancel = options.onCancel || function () {};

    var ariaId = makeAriaId();
    var titleId = ariaId + '-title';
    var bodyId = ariaId + '-body';

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', titleId);
    overlay.setAttribute('aria-describedby', bodyId);

    var modal = document.createElement('div');
    modal.className = 'modal-box';

    var header = document.createElement('div');
    header.className = 'modal-box-header';

    var titleEl = document.createElement('h3');
    titleEl.id = titleId;
    titleEl.textContent = title;
    header.appendChild(titleEl);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'modal-box-close';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = function () {
        closeModal();
        onCancel();
    };
    header.appendChild(closeBtn);

    modal.appendChild(header);

    var body = document.createElement('div');
    body.className = 'modal-box-body';
    body.id = bodyId;

    if (content) {
        var contentEl = document.createElement('p');
        contentEl.style.cssText = 'margin-bottom:12px;font-size:14px;color:var(--color-text-secondary, #666);';
        contentEl.textContent = content;
        body.appendChild(contentEl);
    }

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.placeholder = placeholder;
    body.appendChild(input);

    modal.appendChild(body);

    var footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid var(--color-border, #e0e0e0);';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline-secondary';
    cancelBtn.textContent = cancelText;
    cancelBtn.onclick = function () {
        closeModal();
        onCancel();
    };
    footer.appendChild(cancelBtn);

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.textContent = confirmText;
    confirmBtn.onclick = function () {
        var value = input.value;
        closeModal();
        onConfirm(value);
    };
    footer.appendChild(confirmBtn);

    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
        overlay.classList.add('show');
        trapFocus(modal);
        input.focus();
    });

    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
            closeModal();
            onCancel();
        }
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            var value = input.value;
            closeModal();
            onConfirm(value);
        }
    });

    var modalRef = { overlay: overlay, closeModal: closeModal };
    pushModal(modalRef);

    function closeModal() {
        if (closeModal._called) return;
        closeModal._called = true;

        animateOut(overlay, modal, function () {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            popModal(modalRef);
        });
    }

    return modalRef;
}

function showConfirm(options) {
    return new Promise(function (resolve) {
        showModal({
            title: options.title || '确认',
            content: options.content || '',
            confirmText: options.confirmText || '确认',
            cancelText: options.cancelText || '取消',
            danger: options.danger || false,
            onConfirm: function () { resolve(true); },
            onCancel: function () { resolve(false); }
        });
    });
}

function showAlert(options) {
    options = options || {};
    var title = options.title || '提示';
    var content = options.content || '';
    var confirmText = options.confirmText || '确定';

    var ariaId = makeAriaId();
    var titleId = ariaId + '-title';
    var bodyId = ariaId + '-body';

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', titleId);
    overlay.setAttribute('aria-describedby', bodyId);

    var modal = document.createElement('div');
    modal.className = 'modal-box';

    var header = document.createElement('div');
    header.className = 'modal-box-header';

    var titleEl = document.createElement('h3');
    titleEl.id = titleId;
    titleEl.textContent = title;
    header.appendChild(titleEl);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'modal-box-close';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = closeModal;
    header.appendChild(closeBtn);

    modal.appendChild(header);

    var body = document.createElement('div');
    body.className = 'modal-box-body';
    body.id = bodyId;
    body.innerHTML = content;
    modal.appendChild(body);

    var footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid var(--color-border, #e0e0e0);';

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.textContent = confirmText;
    confirmBtn.onclick = closeModal;
    footer.appendChild(confirmBtn);

    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
        overlay.classList.add('show');
        trapFocus(modal);
        confirmBtn.focus();
    });

    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
            closeModal();
        }
    });

    var modalRef = { overlay: overlay, closeModal: closeModal };
    pushModal(modalRef);

    function closeModal() {
        if (closeModal._called) return;
        closeModal._called = true;

        animateOut(overlay, modal, function () {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            popModal(modalRef);
        });
    }

    return modalRef;
}

window.showModal = showModal;
window.showPrompt = showPrompt;
window.showConfirm = showConfirm;
window.showAlert = showAlert;