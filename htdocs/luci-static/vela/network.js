/* luci-theme-vela: network interface cards
 * Moves the hover tooltip details into the visible stats grid and
 * replaces LuCI's small monochrome interface icons with Vela SVG icons.
 */
(function () {
	'use strict';

	var media = String(document.documentElement.getAttribute('data-shadcn-media') || '/luci-static/vela').replace(/\/$/, '');
	var scheduled = false;

	var iconMap = {
		ethernet: 'ethernet.svg',
		bridge: 'bridge.svg',
		wifi: 'wifi.svg',
		wireless: 'wifi.svg',
		pppoe: 'pppoe.svg',
		ppp: 'pppoe.svg',
		tunnel: 'tunnel.svg',
		vpn: 'tunnel.svg',
		vlan: 'vlan.svg',
		bond: 'bond.svg',
		bonding: 'bond.svg'
	};

	function text(value) {
		return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
	}

	function parseTooltip(tip) {
		var values = {};
		if (!tip) return values;
		var left = tip.querySelector('.left');
		if (!left) return values;
		Array.prototype.forEach.call(left.querySelectorAll(':scope > .nowrap'), function (row) {
			var strong = row.querySelector('strong');
			var label = text(strong ? strong.textContent : '').replace(/[:：]\s*$/, '');
			var value = text(row.textContent).slice(text(strong ? strong.textContent : '').length).trim();
			if (label && value) values[label] = value;
		});
		return values;
	}

	function addField(stats, label, value) {
		if (!stats || !value) return false;
		var labels = Array.prototype.map.call(stats.querySelectorAll(':scope > span.nowrap > strong'), function (strong) {
			return text(strong.textContent).replace(/[:：]\s*$/, '');
		});
		if (labels.indexOf(label) >= 0) return false;

		var span = document.createElement('span');
		span.className = 'nowrap vela-iface-extra';
		var strong = document.createElement('strong');
		strong.textContent = label + ': ';
		span.appendChild(strong);
		span.appendChild(document.createTextNode(value));
		stats.insertBefore(span, stats.firstChild);
		return true;
	}

	function chooseIcon(name, device, kind, base) {
		var n = String(name || '').toLowerCase();
		var d = String(device || '').toLowerCase();
		var k = String(kind || '').toLowerCase();
		var all = n + ' ' + d + ' ' + k;

		if (/vlan/.test(all))
			return 'vlan.svg';
		if (/bond|lag/.test(all))
			return 'bond.svg';
		if (/wifi|wlan|wireless|无线/.test(all))
			return 'wifi.svg';
		if (/pppoe|ppp|wan|拨号/.test(all))
			return 'pppoe.svg';
		if (/tunnel|vpn|wireguard|\bwg\b|tun\d|easy|tailscale|zerotier|隧道/.test(all))
			return 'tunnel.svg';
		if (/bridge|br-|网桥/.test(all) || base === 'bridge')
			return 'bridge.svg';
		if (/ethernet|eth\d|以太网|modem/.test(all) || base === 'ethernet')
			return 'ethernet.svg';

		/* Do not replace an icon we cannot classify; the stock icon is more
		   accurate than a generic placeholder. */
		return base ? iconMap[base] || null : null;
	}

	function replaceIcon(row, img, data) {
		if (!img || img.getAttribute('data-vela-icon') === '1') return;
		var base = String(img.getAttribute('src') || '').split('/').pop().replace(/\.svg.*$/, '').toLowerCase();
		var file = chooseIcon(row.getAttribute('data-sid'), data['设备'] || data.Device, data['类型'] || data.Type, base);
		if (!file) return;
		img.src = media + '/icons/network/' + file;
		img.setAttribute('data-vela-icon', '1');
		img.classList.add('vela-network-icon');
	}

	function processNetwork() {
		scheduled = false;
		var root = document.getElementById('cbi-network-interface');
		if (!root) return;

		Array.prototype.forEach.call(root.querySelectorAll('tr.cbi-section-table-row'), function (row) {
			var stats = row.querySelector('td[data-name="_ifacestat"] [id$="-ifc-description"]');
			var tips = row.querySelectorAll('.ifacebox-body .cbi-tooltip');
			var tip = tips.length ? tips[0] : null;
			var data = parseTooltip(tip);

			/* Only add the fields that the visible stats block does not already
			   provide. Connection state, MAC and byte counters stay in the
			   normal stats grid instead of being duplicated from the tooltip. */
			if (addField(stats, '设备', data['设备'] || data.Device))
				row.classList.add('vela-device-in-stats');
			addField(stats, '类型', data['类型'] || data.Type);

			Array.prototype.forEach.call(tips, function (node) { node.remove(); });
			Array.prototype.forEach.call(row.querySelectorAll('.ifacebox-body img'), function (img) {
				replaceIcon(row, img, data);
			});
		});
	}

	function schedule() {
		if (scheduled) return;
		scheduled = true;
		window.requestAnimationFrame(processNetwork);
	}

	if (document.readyState === 'loading')
		document.addEventListener('DOMContentLoaded', schedule, { once: true });
	else
		schedule();

	document.addEventListener('luci-navigated', schedule);
	new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
})();
