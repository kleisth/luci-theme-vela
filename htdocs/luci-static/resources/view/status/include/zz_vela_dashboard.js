'use strict';
'require baseclass';
'require fs';
'require network';
'require rpc';

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

var callDHCPLeases = rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { '': {} }
});

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

function loadavg(load) {
	if (!Array.isArray(load) || load.length < 3) return '-';
	return [ load[0] / 65535, load[1] / 65535, load[2] / 65535 ].map(function(n) {
		return n.toFixed(2);
	}).join('  ');
}

function ipSort(a, b) {
	function n(ip) {
		var p = String(ip || '').split('.');
		return p.length === 4 ? (((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3]) : 0;
	}
	return n(a.ipaddr) - n(b.ipaddr);
}

function meter(label, used, total, text) {
	var pc = percent(used, total);
	var cls = pc >= 90 ? ' vela-meter-fill--crit' : pc >= 75 ? ' vela-meter-fill--warn' : '';
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

	load: function() {
		return Promise.all([
			L.resolveDefault(callSystemBoard(), {}),
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callCPUUsage(), {}),
			L.resolveDefault(callDHCPLeases(), {}),
			L.resolveDefault(network.getWANNetworks(), []),
			L.resolveDefault(fs.trimmed('/proc/sys/net/netfilter/nf_conntrack_count'), ''),
			L.resolveDefault(fs.trimmed('/proc/sys/net/netfilter/nf_conntrack_max'), '')
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
				conntrackMax: number(String(data[6] || '').trim())
			};
		}, this));
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

		var recentLeases = leases.slice().sort(ipSort).slice(0, 10);
		var leaseRows = recentLeases.map(function(lease) {
			var remaining = '永久';
			if (lease.expires !== false) {
				var left = number(lease.expires);
				remaining = left > 0 ? duration(left) : '已过期';
			}
			return E('tr', {}, [
				E('td', { 'class': 'vela-client-name' }, lease.hostname && lease.hostname !== '*' ? lease.hostname : '未知设备'),
				E('td', {}, E('span', { 'class': 'vela-client-ip' }, lease.ipaddr || '-')),
				E('td', {}, E('span', { 'class': 'vela-client-mac' }, lease.macaddr || '-')),
				E('td', {}, E('span', { 'class': 'vela-lease-badge' }, remaining))
			]);
		});

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
			[ '在线客户机', String(leases.length) ],
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
							percent(d.wanRx, d.wanRx + d.wanTx).toFixed(1) + ' %'),
						meter('上行占比', d.wanTx, d.wanRx + d.wanTx,
							percent(d.wanTx, d.wanRx + d.wanTx).toFixed(1) + ' %')
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

			card('连接概览', 'conntrack 与客户端', 'vela-span-5', E('div', {}, [
				E('div', { 'class': 'vela-big-stat' }, [
					E('strong', {}, connValue.toLocaleString()),
					E('span', {}, '活动连接')
				]),
				E('div', { 'class': 'vela-stat-pair' }, [
					E('div', { 'class': 'vela-stat-box' }, [ E('span', {}, '连接上限'), E('strong', {}, connMax ? connMax.toLocaleString() : '-') ]),
					E('div', { 'class': 'vela-stat-box' }, [ E('span', {}, 'DHCP 客户机'), E('strong', {}, String(leases.length)) ])
				]),
				meter('conntrack 使用率', connValue, connMax || Math.max(connValue, 1),
					connMax ? percent(connValue, connMax).toFixed(1) + ' %' : '-'),
				E('div', { 'class': 'vela-total-grid' }, [
					E('div', {}, [ E('span', {}, 'WAN 连接时间'), E('strong', {}, wan && wan.getUptime() > 0 ? duration(wan.getUptime()) : '-') ]),
					E('div', {}, [ E('span', {}, '采样间隔'), E('strong', {}, '5 秒') ])
				])
			]), '实时'),

			card('客户机', '来自 dnsmasq 的活动 DHCP 租约（最多显示 10 台）', 'vela-span-12',
				recentLeases.length ? E('div', { 'class': 'vela-clients-wrap' }, [
					E('table', { 'class': 'vela-clients' }, [
						E('thead', {}, E('tr', {}, [
							E('th', {}, '主机名'),
							E('th', {}, 'IPv4'),
							E('th', {}, 'MAC'),
							E('th', {}, '租约剩余')
						])),
						E('tbody', {}, leaseRows)
					])
				]) : E('div', { 'class': 'vela-empty' }, '当前没有活动 DHCP 租约'),
				String(leases.length) + ' 台')
		]);

		window.setTimeout(L.bind(function() { self._activate(rootEl); }, this), 0);
		return rootEl;
	}
});
