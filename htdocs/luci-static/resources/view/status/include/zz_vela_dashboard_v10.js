'use strict';
'require baseclass';
'require fs';
'require network';
'require rpc';
'require uci';

var callSystemBoard = rpc.declare({
	object: 'system',
	method: 'board'
});

var callSystemInfo = rpc.declare({
	object: 'system',
	method: 'info'
});

var callCPUUsage = rpc.declare({
	object: 'luci',
	method: 'getCPUUsage'
});

var callCPUBench = rpc.declare({
	object: 'luci',
	method: 'getCPUBench'
});

var callDHCPLeases = rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { '': {} }
});

var callBandixVersion = rpc.declare({
	object: 'luci.bandix',
	method: 'getVersion',
	expect: {}
});

var callBandixStatus = rpc.declare({
	object: 'luci.bandix',
	method: 'getStatus',
	expect: {}
});

var callBandixConnections = rpc.declare({
	object: 'luci.bandix',
	method: 'getConnection',
	expect: {}
});

var callVelaStatus = rpc.declare({
	object: 'vela',
	method: 'status',
	expect: {}
});

var callVelaConnect = rpc.declare({
	object: 'vela',
	method: 'connect',
	expect: {}
});

var callVelaDisconnect = rpc.declare({
	object: 'vela',
	method: 'disconnect',
	expect: {}
});

function normMac(value) {
	return String(value || '').toLowerCase();
}

function number(value) {
	var n = Number(value);
	return isFinite(n) ? n : 0;
}

function bytes(value) {
	var n = number(value), units = [ 'B', 'KB', 'MB', 'GB', 'TB' ], i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return (i === 0 ? n.toFixed(0) : n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)) + ' ' + units[i];
}

function rate(value) {
	return bytes(value) + '/s';
}

function velaPhaseText(st) {
	if (!st) return '未知';
	if (st.protected) return '已保护';
	if (st.phase === 'connected') return '已连接';
	if (st.phase === 'connecting' || st.phase === 'reconnecting') return '连接中';
	if (st.phase === 'degraded') return '已连接 · 打洞未完成';
	if (st.phase === 'error') return '连接失败';
	if (st.phase === 'auth_required') return '未登录';
	return '未连接';
}

function velaStateClass(st) {
	if (!st) return 'off';
	if (st.protected || st.phase === 'connected') return 'ok';
	if (st.phase === 'degraded') return 'warn';
	if (st.phase === 'error') return 'bad';
	return 'off';
}

function velaExitText(st) {
	if (!st || !st.exit) return '—';
	return (st.exit.country || st.exit.code || '未知') + ' · ' + (st.exit.ip || '—');
}

function duration(seconds) {
	var s = Math.max(0, Math.floor(number(seconds)));
	var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
	    m = Math.floor((s % 3600) / 60), sec = s % 60;
	if (d > 0) return d + ' 天 ' + h + ' 小时';
	if (h > 0) return h + ' 小时 ' + m + ' 分';
	if (m > 0) return m + ' 分 ' + sec + ' 秒';
	return sec + ' 秒';
}

function percent(used, total) {
	var t = number(total), u = number(used);
	if (t <= 0) return 0;
	return Math.max(0, Math.min(100, u * 100 / t));
}

function coremark(bench) {
	var match = String((bench && bench.cpubench) || '').match(/[0-9]+(?:\.[0-9]+)?/);
	return match ? Math.round(Number(match[0])) : null;
}

function loadavg(load) {
	if (!Array.isArray(load) || load.length < 3) return '-';
	return [ load[0] / 65535, load[1] / 65535, load[2] / 65535 ].map(function(n) {
		return n.toFixed(2);
	}).join('  ');
}

function isVelaTheme() {
	var media = (L.env && L.env.media) || document.documentElement.getAttribute('data-shadcn-media') || '';
	return String(media).replace(/\/$/, '').endsWith('/vela');
}

function ipSort(a, b) {
	function n(ip) {
		var p = String(ip || '').split('.');
		return p.length === 4 ? (((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3]) : 0;
	}
	return n(a.ipaddr) - n(b.ipaddr);
}

function meter(label, used, total, text, plain) {
	var pc = percent(used, total);
	var cls = plain ? '' : (pc >= 90 ? ' vela-meter-fill--crit' : pc >= 75 ? ' vela-meter-fill--warn' : '');
	return E('div', { 'class': 'vela-meter' }, [
		E('div', { 'class': 'vela-meter-head' }, [
			E('span', {}, label),
			E('strong', {}, text || (bytes(used) + ' / ' + bytes(total)))
		]),
		E('div', { 'class': 'vela-meter-track' }, [
			E('div', { 'class': 'vela-meter-fill' + cls, 'style': 'width:' + pc.toFixed(1) + '%' })
		])
	]);
}

function kv(rows) {
	var children = [];
	rows.forEach(function(row) {
		if (row[1] == null || row[1] === '')
			return;
		children.push(E('dt', {}, row[0]));
		children.push(E('dd', { 'class': row[2] ? 'vela-mono' : '' }, row[1]));
	});
	return E('dl', { 'class': 'vela-kv vela-kv-grid' }, children);
}

function card(title, sub, span, body, kicker) {
	return E('section', { 'class': 'vela-card ' + span }, [
		E('div', { 'class': 'vela-card-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'vela-card-title' }, title),
				sub ? E('p', { 'class': 'vela-card-sub' }, sub) : null
			]),
			kicker ? E('span', { 'class': 'vela-kicker' }, kicker) : null
		]),
		body
	]);
}

function drawChart(canvas, history) {
	var rect = canvas.getBoundingClientRect(),
	    width = Math.max(320, Math.round(rect.width || 640)),
	    height = 126,
	    dpr = window.devicePixelRatio || 1,
	    ctx;

	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	canvas.style.height = height + 'px';
	ctx = canvas.getContext('2d');
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, width, height);

	var pad = 6, bottom = 16, plotW = width - pad * 2, plotH = height - pad - bottom,
	    max = 1;

	(history || []).forEach(function(p) {
		max = Math.max(max, number(p.rx), number(p.tx));
	});

	ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border') || '#e2e8f0';
	ctx.globalAlpha = 0.75;
	ctx.lineWidth = 1;
	ctx.setLineDash([ 3, 4 ]);
	for (var g = 0; g <= 3; g++) {
		var y = pad + plotH * g / 3;
		ctx.beginPath();
		ctx.moveTo(pad, y);
		ctx.lineTo(width - pad, y);
		ctx.stroke();
	}
	ctx.setLineDash([]);
	ctx.globalAlpha = 1;

	if (!history || history.length < 2) {
		ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground') || '#64748b';
		ctx.font = '12px Inter, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('正在采集实时速率…', width / 2, height / 2);
		return;
	}

	function point(index, key) {
		var x = pad + plotW * index / (history.length - 1),
		    v = number(history[index][key]),
		    y = pad + plotH - (v / max) * plotH;
		return [ x, y ];
	}

	function line(key) {
		ctx.beginPath();
		for (var i = 0; i < history.length; i++) {
			var p = point(i, key);
			if (i === 0) ctx.moveTo(p[0], p[1]);
			else ctx.lineTo(p[0], p[1]);
		}
	}

	var grad = ctx.createLinearGradient(0, pad, 0, pad + plotH);
	grad.addColorStop(0, 'rgba(14,165,233,0.22)');
	grad.addColorStop(1, 'rgba(14,165,233,0.01)');

	line('rx');
	ctx.lineTo(pad + plotW, pad + plotH);
	ctx.lineTo(pad, pad + plotH);
	ctx.closePath();
	ctx.fillStyle = grad;
	ctx.fill();

	line('tx');
	ctx.strokeStyle = '#8b5cf6';
	ctx.lineWidth = 2.2;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.stroke();

	line('rx');
	ctx.strokeStyle = '#0ea5e9';
	ctx.lineWidth = 2.4;
	ctx.stroke();

	ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground') || '#64748b';
	ctx.font = '10px Inter, sans-serif';
	ctx.textAlign = 'left';
	ctx.fillText('近 ' + Math.round(history.length * 5 / 60 * 10) / 10 + ' 分钟', pad, height - 2);
	ctx.textAlign = 'right';
	ctx.fillText(rate(max), width - pad, height - 2);
}

return baseclass.extend({
	title: _('Vela Dashboard'),

	_last: null,
	_history: [],
	_benchPromise: null,
	_bandixProbe: null,
	_clientSort: { key: null, dir: -1 },

	getBandixProbe: function() {
		if (!this._bandixProbe)
			this._bandixProbe = L.resolveDefault(callBandixVersion(), null).then(function(version) {
				return { installed: !!version };
			});
		return this._bandixProbe;
	},

	setClientSort: function(root, key) {
		var sort = this._clientSort || { key: null, dir: -1 };
		sort.dir = sort.key === key ? -sort.dir : -1;
		sort.key = key;
		this._clientSort = sort;
		this.applyClientSort(root);
	},

	applyClientSort: function(root) {
		var table = root && root.querySelector('.vela-clients'),
		    tbody = table && table.tBodies && table.tBodies[0],
		    key = this._clientSort && this._clientSort.key,
		    dir = this._clientSort && this._clientSort.dir;
		if (!tbody || !key)
			return;

		var rows = Array.prototype.slice.call(tbody.rows);
		rows.forEach(function(row, index) { row.__velaIndex = index; });
		rows.sort(function(a, b) {
			var av = a.getAttribute('data-sort-' + key),
			    bv = b.getAttribute('data-sort-' + key),
			    am = av == null || av === '',
			    bm = bv == null || bv === '';
			if (am && bm) return a.__velaIndex - b.__velaIndex;
			if (am) return 1;
			if (bm) return -1;
			var diff = (number(av) - number(bv)) * dir;
			return diff || (a.__velaIndex - b.__velaIndex);
		});
		rows.forEach(function(row) { tbody.appendChild(row); });

		Array.prototype.forEach.call(table.querySelectorAll('th[data-sort]'), function(th) {
			var active = th.getAttribute('data-sort') === key;
			th.classList.toggle('vela-sort-active', active);
			if (active) th.setAttribute('data-dir', String(dir));
			else th.removeAttribute('data-dir');
		});
	},

	getBench: function() {
		if (!this._benchPromise)
			this._benchPromise = L.resolveDefault(callCPUBench(), {});
		return this._benchPromise;
	},

	load: function() {
		if (!isVelaTheme())
			return Promise.resolve(null);

		return Promise.all([
			L.resolveDefault(callSystemBoard(), {}),
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callCPUUsage(), {}),
			L.resolveDefault(callDHCPLeases(), {}),
			L.resolveDefault(network.getWANNetworks(), []),
			L.resolveDefault(fs.trimmed('/proc/sys/net/netfilter/nf_conntrack_count'), ''),
			L.resolveDefault(fs.trimmed('/proc/sys/net/netfilter/nf_conntrack_max'), ''),
			this.getBench(),
			this.getBandixProbe(),
			L.resolveDefault(callBandixStatus(), null),
			L.resolveDefault(callBandixConnections(), null),
			L.resolveDefault(uci.load('bandix'), null),
			L.resolveDefault(callVelaStatus(), null)
		]).then(L.bind(function(data) {
			var board = L.isObject(data[0]) ? data[0] : {},
			    system = L.isObject(data[1]) ? data[1] : {},
			    cpu = L.isObject(data[2]) ? data[2] : {},
			    leases = L.isObject(data[3]) ? data[3] : {},
			    wans = Array.isArray(data[4]) ? data[4] : [],
			    wan = wans.length ? wans[0] : null,
			    rx = 0, tx = 0, now = Date.now(),
			    rxRate = 0, txRate = 0;

			if (wan) {
				try {
					var wanDev = wan.getL3Device();
					rx = wanDev ? number(wanDev.getRXBytes()) : 0;
					tx = wanDev ? number(wanDev.getTXBytes()) : 0;
				} catch (e) {
					rx = 0;
					tx = 0;
				}
			}

			if (this._last && now > this._last.t + 250) {
				rxRate = Math.max(0, (rx - this._last.rx) * 1000 / (now - this._last.t));
				txRate = Math.max(0, (tx - this._last.tx) * 1000 / (now - this._last.t));
			}

			this._last = { t: now, rx: rx, tx: tx };
			this._history.push({ rx: rxRate, tx: txRate });
			if (this._history.length > 36)
				this._history.shift();

			return {
				board: board,
				system: system,
				cpu: cpu,
				leases: leases,
				wan: wan,
				wanRx: rx,
				wanTx: tx,
				rxRate: rxRate,
				txRate: txRate,
				history: this._history.slice(),
				conntrack: number(String(data[5] || '').trim()),
				conntrackMax: number(String(data[6] || '').trim()),
				coremark: coremark(data[7]),
				bandixInstalled: !!(data[8] && data[8].installed) ||
					!!uci.get('bandix', 'general', 'iface'),
				bandixTraffic: uci.get('bandix', 'traffic', 'enabled') === '1',
				bandixConnections: uci.get('bandix', 'connections', 'enabled') === '1',
				bandixStatus: data[9] || null,
				bandixConnData: data[10] || null,
				vela: L.isObject(data[12]) ? data[12] : null
			};
		}, this));
	},

	renderVelaBody: function(body, st) {
		var self = this,
		    stats = st.stats || {},
		    connected = st.phase === 'connected' || st.phase === 'degraded',
		    connecting = st.phase === 'connecting' || st.phase === 'reconnecting';

		body.innerHTML = '';
		body.appendChild(E('div', { 'class': 'vela-vela-head' }, [
			E('span', { 'class': 'vela-vela-state ' + velaStateClass(st) }, velaPhaseText(st))
		]));
		body.appendChild(E('div', { 'class': 'vela-stat-pair' }, [
			E('div', { 'class': 'vela-stat-box' }, [ E('span', {}, '实时下行'), E('strong', {}, rate(stats.down_rate || 0)) ]),
			E('div', { 'class': 'vela-stat-box' }, [ E('span', {}, '实时上行'), E('strong', {}, rate(stats.up_rate || 0)) ]),
			E('div', { 'class': 'vela-stat-box' }, [ E('span', {}, '活动连接'), E('strong', {}, String(number(stats.connections))) ]),
			E('div', { 'class': 'vela-stat-box' }, [ E('span', {}, '运行时长'), E('strong', {}, stats.running ? duration(stats.uptime) : '—') ])
		]));
		body.appendChild(E('div', { 'class': 'vela-vela-meta' }, [
			E('div', {}, [ E('span', {}, '出口'), E('strong', {}, velaExitText(st)) ]),
			E('div', {}, [ E('span', {}, '账号'), E('strong', {}, st.account && st.account.username ? st.account.username : '—') ])
		]));
		body.__velaStatus = st;
		body.appendChild(E('div', { 'class': 'vela-vela-actions' }, [
			E('button', {
				'class': 'cbi-button cbi-button-apply',
				disabled: connected || connecting ? 'disabled' : null,
				click: function() { self.velaAction(body, 'connect'); }
			}, connecting ? '正在连接…' : '连接'),
			E('button', {
				'class': 'cbi-button cbi-button-reset',
				disabled: !connected || connecting ? 'disabled' : null,
				click: function() { self.velaAction(body, 'disconnect'); }
			}, '断开'),
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				disabled: connecting ? 'disabled' : null,
				click: function() { self.velaAction(body, 'reconnect'); }
			}, '重新连接')
		]));
		if (st.error)
			body.appendChild(E('div', { 'class': 'vela-vela-error' }, st.error));

		var cardNode = body.closest('.vela-card');
		var kicker = cardNode && cardNode.querySelector('.vela-kicker');
		if (kicker) kicker.textContent = velaPhaseText(st);
	},

	velaAction: function(body, action) {
		var self = this;
		Array.prototype.forEach.call(body.querySelectorAll('button'), function(btn) { btn.disabled = true; });

		var request;
		if (action === 'disconnect')
			request = callVelaDisconnect();
		else if (action === 'reconnect') {
			var current = body.__velaStatus,
			    wasConnected = current && (current.phase === 'connected' || current.phase === 'degraded');
			request = wasConnected
				? callVelaDisconnect()
					.then(function() { return new Promise(function(resolve) { window.setTimeout(resolve, 900); }); })
					.then(function() { return callVelaConnect(); })
				: callVelaConnect();
		}
		else
			request = callVelaConnect();

		request.then(function() {
			return new Promise(function(resolve) { window.setTimeout(resolve, 700); });
		}).then(function() {
			return callVelaStatus();
		}).then(function(status) {
			if (!status) throw new Error('无法读取 Vela 状态');
			self.renderVelaBody(body, status);
		}).catch(function(err) {
			Array.prototype.forEach.call(body.querySelectorAll('button'), function(btn) { btn.disabled = false; });
			body.appendChild(E('div', { 'class': 'vela-vela-error' }, err && err.message ? err.message : '操作失败'));
		});
	},

	_activate: function(root) {
		var section, view, canvases;

		if (!root || !root.parentNode) {
			window.setTimeout(L.bind(this._activate, this, root), 50);
			return;
		}

		section = root.closest('.cbi-section');
		if (section)
			section.classList.add('vela-dash-section');

		view = root.closest('#view');
		if (view)
			view.classList.add('vela-dash-ready');

		canvases = root.querySelectorAll('canvas.vela-chart');
		for (var i = 0; i < canvases.length; i++)
			drawChart(canvases[i], canvases[i].__velaHistory || []);
	},

	render: function(d) {
		if (!d)
			return null;

		var self = this,
		    board = d.board || {},
		    system = d.system || {},
		    cpu = d.cpu || {},
		    wan = d.wan,
		    leases = Array.isArray(d.leases.dhcp_leases) ? d.leases.dhcp_leases : [],
		    hostname = board.hostname || 'Router',
		    model = board.model || board.system || 'OpenWrt',
		    firmware = L.isObject(board.release) ? (board.release.description || '') : '',
		    mem = L.isObject(system.memory) ? system.memory : {},
		    root = L.isObject(system.root) ? system.root : {},
		    memTotal = number(mem.total),
		    memUsed = Math.max(0, number(mem.total) - number(mem.available || mem.free || 0)),
		    storageTotal = number(root.total) * 1024,
		    storageUsed = number(root.used) * 1024,
		    cpuUsage = number(cpu.cpuusage),
		    uptime = number(system.uptime),
		    wanDev = null,
		    wanAddrs = [], wanDns = [], wanGateway = '';

		if (wan) {
			try { wanAddrs = wan.getIPAddrs() || []; } catch (e) { wanAddrs = []; }
			try { wanDns = wan.getDNSAddrs() || []; } catch (e) { wanDns = []; }
			try { wanGateway = wan.getGatewayAddr() || ''; } catch (e) { wanGateway = ''; }
			try { wanDev = wan.getL3Device(); } catch (e) { wanDev = null; }
		}

		var bandixByMac = {}, bandixByIp = {}, connByMac = {}, connByIp = {};
		var bandixDevices = d.bandixStatus && Array.isArray(d.bandixStatus.d) ? d.bandixStatus.d : [];
		var bandixConns = d.bandixConnData && d.bandixConnData.data && Array.isArray(d.bandixConnData.data.d)
			? d.bandixConnData.data.d : [];

		bandixDevices.forEach(function(dev) {
			if (dev.mac) bandixByMac[normMac(dev.mac)] = dev;
			if (dev.ip4) bandixByIp[dev.ip4] = dev;
		});
		bandixConns.forEach(function(dev) {
			if (dev.mac) connByMac[normMac(dev.mac)] = dev;
			if (dev.ip4) connByIp[dev.ip4] = dev;
		});

		function bandixStat(lease) {
			return bandixByMac[normMac(lease.macaddr)] || bandixByIp[lease.ipaddr] || null;
		}
		function bandixConn(lease) {
			return connByMac[normMac(lease.macaddr)] || connByIp[lease.ipaddr] || null;
		}

		var showRates = !!d.bandixInstalled && !!d.bandixTraffic;
		var showConns = !!d.bandixInstalled && !!d.bandixConnections;

		/* DHCP leases are the normal client list, but static-IP clients never
		   appear there. Add recently active Bandix devices so their WAN
		   rates and connections are visible too. */
		var clientList = leases.slice();
		if (d.bandixInstalled && bandixDevices.length) {
			var nowMs = Date.now(), seenMac = {}, seenIp = {};
			leases.forEach(function(lease) {
				if (lease.macaddr) seenMac[normMac(lease.macaddr)] = true;
				if (lease.ipaddr) seenIp[lease.ipaddr] = true;
			});
			bandixDevices.forEach(function(dev) {
				var last = number(dev.last);
				if (!dev.mac && !dev.ip4) return;
				if (last && nowMs - last > 10 * 60 * 1000) return;
				if ((dev.mac && seenMac[normMac(dev.mac)]) || (dev.ip4 && seenIp[dev.ip4])) return;
				clientList.push({
					hostname: String(dev.host || '').replace(/\.lan$/i, '') || '*',
					ipaddr: dev.ip4 || '',
					macaddr: dev.mac || '',
					expires: null,
					_bandixOnly: true
				});
			});
		}
		var recentLeases = clientList.sort(ipSort);
		var clientCount = clientList.length;
		var leaseRows = recentLeases.map(function(lease) {
			var remaining = '—';
			if (!lease._bandixOnly) {
				remaining = '永久';
				if (lease.expires !== false) {
					var left = number(lease.expires);
					remaining = left > 0 ? duration(left) : '已过期';
				}
			}			var stat = bandixStat(lease);
			var conn = bandixConn(lease);
			var leaseSort = lease._bandixOnly ? null :
				(lease.expires === false ? 2147483647 : number(lease.expires));
			var row = [
				E('td', { 'class': 'vela-client-name vela-col-host' }, [
					E('div', { 'class': 'vela-client-host' }, lease.hostname && lease.hostname !== '*' ? lease.hostname : '未知设备'),
					E('div', { 'class': 'vela-client-mac' }, lease.macaddr || '-')
				]),
				E('td', { 'class': 'vela-col-ip' }, E('span', { 'class': 'vela-client-ip' }, lease.ipaddr || '-'))
			];
			if (showRates) {
				row.push(E('td', { 'class': 'vela-col-rate' }, E('span', { 'class': 'vela-client-rate' }, stat ? ('↓ ' + rate(number(stat.w_rx_r))) : '—')));
				row.push(E('td', { 'class': 'vela-col-rate' }, E('span', { 'class': 'vela-client-rate' }, stat ? ('↑ ' + rate(number(stat.w_tx_r))) : '—')));
			}
			if (showConns) {
				row.push(E('td', { 'class': 'vela-col-conn' }, conn
					? E('div', { 'class': 'vela-conn' }, [
						E('strong', {}, String(number(conn.total))),
						E('span', { 'class': 'vela-conn-detail' }, 'TCP ' + number(conn.tcp) + ' / UDP ' + number(conn.udp))
					])
					: '—'));
			}
			row.push(E('td', { 'class': 'vela-col-lease' }, E('span', { 'class': 'vela-lease-badge' + (lease._bandixOnly ? ' vela-lease-badge--none' : '') }, remaining)));
			return E('tr', {
				'data-sort-down': stat ? String(number(stat.w_rx_r)) : '',
				'data-sort-up': stat ? String(number(stat.w_tx_r)) : '',
				'data-sort-conn': conn ? String(number(conn.total)) : '',
				'data-sort-lease': leaseSort == null ? '' : String(leaseSort),
				'data-sort-ip': lease.ipaddr || ''
			}, row);
		});

		var bandixNotice = null;
		if (!d.bandixInstalled) {
			bandixNotice = E('div', { 'class': 'vela-bandix-note' }, [
				E('div', { 'class': 'vela-bandix-copy' }, [
					E('strong', {}, '未检测到 Bandix'),
					E('span', {}, '安装 Bandix 后，这里可直接显示每台客户机的 WAN 实时速率和 TCP/UDP 连接数。')
				]),
				E('a', {
					'class': 'vela-btn',
					href: 'https://github.com/timsaya/openwrt-bandix',
					target: '_blank',
					rel: 'noreferrer'
				}, '查看项目')
			]);
		}
		else if (!d.bandixTraffic || !d.bandixConnections || !d.bandixStatus || !d.bandixConnData) {
			var missing = [];
			if (!d.bandixTraffic) missing.push('流量监控');
			if (!d.bandixConnections) missing.push('连接监控');
			if (!d.bandixStatus || !d.bandixConnData) missing.push('统计数据');
			bandixNotice = E('div', { 'class': 'vela-bandix-note' }, [
				E('div', { 'class': 'vela-bandix-copy' }, [
					E('strong', {}, 'Bandix 已安装，但' + missing.join('、') + '未启用'),
					E('span', {}, '开启后即可在此显示 WAN 速率与 TCP/UDP 连接数。')
				]),
				E('a', {
					'class': 'vela-btn',
					href: L.url('admin/network/bandix/settings')
				}, '打开 Bandix 设置')
			]);
		}

		var systemRows = [
			[ '主机名', hostname ],
			[ '型号', model ],
			[ '固件', firmware || '-' ],
			[ '内核', board.kernel || '-' ],
			[ '架构', board.system || '-' ],
			[ '运行时间', duration(uptime) ],
			[ '平均负载', loadavg(system.load) ],
			[ 'CPU 占用', cpuUsage.toFixed(0) + ' %' ]
		];

		var wanRows = wan ? [
			[ '接口', wan.getName() + ' · ' + (wan.getI18n() || '') ],
			[ 'IPv4', wanAddrs.length ? wanAddrs.join(', ') : '未分配', true ],
			[ '网关', wanGateway || '-', true ],
			[ 'DNS', wanDns.length ? wanDns.join(', ') : '-', true ],
			[ '设备', wanDev ? (wanDev.getName() || wanDev.getI18n() || '-') : '-', true ],
			[ '连接时间', wan.getUptime() > 0 ? duration(wan.getUptime()) : '-' ]
		] : [
			[ '状态', 'WAN 未连接' ]
		];

		var heroMetrics = [
			[ '运行时间', duration(uptime) ],
			[ '平均负载', loadavg(system.load) ],
			[ '在线客户机', String(clientCount) ],
			[ '活动连接', d.conntrack > 0 ? String(d.conntrack) : '-' ],
			[ '实时下行', rate(d.rxRate) ]
		].map(function(m) {
			return E('li', {}, [
				E('span', {}, m[0]),
				E('strong', {}, m[1])
			]);
		});

		var chart = E('canvas', { 'class': 'vela-chart' });
		chart.__velaHistory = d.history;

		var connValue = d.conntrack > 0 ? d.conntrack : 0;
		var connMax = d.conntrackMax > 0 ? d.conntrackMax : 0;
		var connectionCard;

		if (d.vela) {
			var velaBody = E('div', { 'class': 'vela-vela-conn' });
			this.renderVelaBody(velaBody, d.vela);
			connectionCard = card('连接概览', 'Vela 插件连接状态与控制', 'vela-span-5',
				velaBody, velaPhaseText(d.vela));
		}
		else {
			connectionCard = card('连接概览', 'conntrack 与客户端', 'vela-span-5', E('div', {}, [
				E('div', { 'class': 'vela-big-stat' }, [
					E('strong', {}, connValue.toLocaleString()),
					E('span', {}, '活动连接')
				]),
				E('div', { 'class': 'vela-stat-pair' }, [
					E('div', { 'class': 'vela-stat-box' }, [ E('span', {}, '连接上限'), E('strong', {}, connMax ? connMax.toLocaleString() : '-') ]),
					E('div', { 'class': 'vela-stat-box' }, [ E('span', {}, '客户机'), E('strong', {}, String(clientCount)) ])
				]),
				meter('conntrack 使用率', connValue, connMax || Math.max(connValue, 1),
					connMax ? percent(connValue, connMax).toFixed(1) + ' %' : '-'),
				E('div', { 'class': 'vela-total-grid' }, [
					E('div', {}, [ E('span', {}, 'WAN 连接时间'), E('strong', {}, wan && wan.getUptime() > 0 ? duration(wan.getUptime()) : '-') ]),
					E('div', {}, [ E('span', {}, '采样间隔'), E('strong', {}, '5 秒') ])
				])
			]), '实时');
		}

		var rootEl = E('div', { 'class': 'vela-dash' }, [
			E('section', { 'class': 'vela-dash-hero' }, [
				E('div', {}, [
					E('p', { 'class': 'vela-hero-eyebrow' }, 'VELA · SYSTEM DASHBOARD'),
					E('h1', { 'class': 'vela-hero-title' }, [
						hostname,
						E('span', { 'class': 'vela-status-pill' }, [
							E('i', { 'class': 'vela-status-dot' }),
							wan ? 'WAN 在线' : 'WAN 未连接'
						])
					]),
					E('p', { 'class': 'vela-hero-sub' }, model + (firmware ? ' · ' + firmware : ''))
				]),
				E('div', { 'class': 'vela-hero-coremark' }, [
					E('span', {}, 'CoreMark：'),
					E('strong', {}, d.coremark != null ? d.coremark.toLocaleString('en-US') : '—')
				]),
				E('ul', { 'class': 'vela-hero-metrics' }, heroMetrics)
			]),

			card('系统信息', '主机、固件与资源占用', 'vela-span-7', E('div', {}, [
				kv(systemRows),
				E('div', { 'class': 'vela-kv-grid' }, [
					meter('内存', memUsed, memTotal),
					meter('存储 /', storageUsed, storageTotal),
					meter('CPU', cpuUsage, 100, cpuUsage.toFixed(0) + ' %'),
					meter('连接数', connValue, connMax || Math.max(connValue, 1),
						connMax ? connValue + ' / ' + connMax : String(connValue))
				])
			]), '运行中'),

			card('WAN 信息', '上游链路与地址', 'vela-span-5',
				wan ? E('div', {}, [
					kv(wanRows),
					E('div', { 'class': 'vela-total-grid' }, [
						E('div', {}, [ E('span', {}, '累计下行'), E('strong', {}, bytes(d.wanRx)) ]),
						E('div', {}, [ E('span', {}, '累计上行'), E('strong', {}, bytes(d.wanTx)) ])
					]),
					E('div', { 'class': 'vela-kv-grid' }, [
						meter('下行占比', d.wanRx, d.wanRx + d.wanTx,
							percent(d.wanRx, d.wanRx + d.wanTx).toFixed(1) + ' %', true),
						meter('上行占比', d.wanTx, d.wanRx + d.wanTx,
							percent(d.wanTx, d.wanRx + d.wanTx).toFixed(1) + ' %', true)
					])
				]) : E('div', { 'class': 'vela-empty' }, '未检测到默认 WAN 接口'),
				wan ? '在线' : '未连接'),

			card('实时流量', 'WAN 设备计数器，每 5 秒采样', 'vela-span-7', E('div', {}, [
				E('div', { 'class': 'vela-traffic-top' }, [
					E('div', { 'class': 'vela-rate-pair' }, [
						E('span', { 'class': 'vela-rate' }, [
							E('b', { 'class': 'vela-arrow-down' }, '↓'),
							E('b', {}, rate(d.rxRate))
						]),
						E('span', { 'class': 'vela-rate' }, [
							E('b', { 'class': 'vela-arrow-up' }, '↑'),
							E('b', {}, rate(d.txRate))
						])
					]),
					E('span', { 'class': 'vela-kicker' }, '近 3 分钟')
				]),
				chart,
				E('div', { 'class': 'vela-chart-legend' }, [
					E('span', {}, [ E('i', { 'style': 'background:#0ea5e9' }), '下行' ]),
					E('span', {}, [ E('i', { 'style': 'background:#8b5cf6' }), '上行' ])
				]),
			]), wan ? '实时' : '无数据'),

			connectionCard,

			card('客户机', 'DHCP 租约 + Bandix 活跃客户机' + (showRates || showConns ? ' · WAN 速率与连接数' : ''), 'vela-span-12',
				E('div', {}, [
					bandixNotice,
					recentLeases.length ? E('div', { 'class': 'vela-clients-wrap' }, [
						E('table', { 'class': 'vela-clients' }, [
							E('thead', {}, E('tr', {}, (function() {
								var headers = [ E('th', { 'class': 'vela-col-host' }, '主机名'), E('th', { 'class': 'vela-col-ip' }, 'IPv4') ];
								if (showRates) {
									headers.push(E('th', { 'class': 'vela-col-rate', 'data-sort': 'down', title: '点击切换最大/最小排序' }, 'WAN 下行'));
									headers.push(E('th', { 'class': 'vela-col-rate', 'data-sort': 'up', title: '点击切换最大/最小排序' }, 'WAN 上行'));
								}
								if (showConns) headers.push(E('th', { 'class': 'vela-col-conn', 'data-sort': 'conn', title: '点击切换最大/最小排序' }, '连接数'));
								headers.push(E('th', { 'class': 'vela-col-lease', 'data-sort': 'lease', title: '点击切换最大/最小排序' }, '租约剩余'));
								return headers;
							})())),
							E('tbody', {}, leaseRows)
						])
					]) : E('div', { 'class': 'vela-empty' }, '当前没有活动 DHCP 租约')
				]),
				String(clientCount) + ' 台')
		]);

		var clientTable = rootEl.querySelector('.vela-clients');
		if (clientTable) {
			Array.prototype.forEach.call(clientTable.querySelectorAll('th[data-sort]'), function(th) {
				th.setAttribute('tabindex', '0');
				th.addEventListener('click', function() {
					self.setClientSort(rootEl, th.getAttribute('data-sort'));
				});
				th.addEventListener('keydown', function(ev) {
					if (ev.key === 'Enter' || ev.key === ' ') {
						ev.preventDefault();
						self.setClientSort(rootEl, th.getAttribute('data-sort'));
					}
				});
			});
			if (self._clientSort && self._clientSort.key)
				self.applyClientSort(rootEl);
		}

		window.setTimeout(L.bind(function() { self._activate(rootEl); }, this), 0);
		return rootEl;
	}
});
