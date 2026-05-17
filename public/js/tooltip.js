var Tooltip = (function() {
    var currentTooltip = null;
    var timer = null;
    
    function init() {
        document.body.addEventListener('mouseenter', function(e) {
            var target = e.target.closest('[data-tooltip]');
            if (!target) return;
            
            var text = target.getAttribute('data-tooltip');
            var position = target.getAttribute('data-tooltip-position') || 'top';
            
            timer = setTimeout(function() {
                showTooltip(target, text, position);
            }, 300);
        }, true);
        
        document.body.addEventListener('mouseleave', function(e) {
            var target = e.target.closest('[data-tooltip]');
            if (!target) return;
            
            clearTimeout(timer);
            hideTooltip();
        }, true);
    }
    
    function showTooltip(target, text, position) {
        hideTooltip();
        
        var tooltip = document.createElement('div');
        tooltip.className = 'tooltip tooltip-' + position;
        tooltip.textContent = text;
        
        document.body.appendChild(tooltip);
        
        var targetRect = target.getBoundingClientRect();
        var tooltipRect = tooltip.getBoundingClientRect();
        
        var top, left;
        
        if (position === 'top') {
            top = targetRect.top - tooltipRect.height - 8;
            left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        } else if (position === 'bottom') {
            top = targetRect.bottom + 8;
            left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        } else if (position === 'left') {
            top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
            left = targetRect.left - tooltipRect.width - 8;
        } else if (position === 'right') {
            top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
            left = targetRect.right + 8;
        }
        
        if (left < 8) left = 8;
        if (left + tooltipRect.width > window.innerWidth - 8) left = window.innerWidth - tooltipRect.width - 8;
        if (top < 8) top = 8;
        if (top + tooltipRect.height > window.innerHeight - 8) top = window.innerHeight - tooltipRect.height - 8;
        
        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
        
        currentTooltip = tooltip;
    }
    
    function hideTooltip() {
        if (currentTooltip) {
            currentTooltip.remove();
            currentTooltip = null;
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    return { init: init };
})();

window.Tooltip = Tooltip;