# luci-theme-vela

A modern LuCI theme for ImmortalWrt / OpenWrt, based on
[luci-theme-shadcn](https://github.com/eamonxg/luci-theme-shadcn) and inspired by the
Vela client UI.

## Features

- Dark / light / follow-system appearance, same shell as shadcn.
- Vela-styled palette: deep navy, blue and cyan accents, soft cards and rounded panels.
- A Vela-styled shell for every LuCI page: dark navy sidebar, rounded cards, unified
  pill tabs, tuned tables, forms, buttons, alerts and terminal/log panels.
- A redesigned status overview built as a responsive dashboard:
  - system, firmware, kernel, load, CPU, memory and storage;
  - WAN protocol, address, gateway, DNS and uptime;
  - conntrack active/max, DHCP client count;
  - WAN traffic totals and a live RX/TX rate chart;
  - DHCP client table with hostname, IP, MAC and lease remaining time.
- Responsive 12-column layout that collapses to one column on mobile.
- No account, credential or device-specific data is included.

## Install

### Build into firmware

~~~sh
cp -a luci-theme-vela /path/to/immortalwrt/package/
cd /path/to/immortalwrt
echo 'CONFIG_PACKAGE_luci-theme-vela=y' >> .config
make defconfig
make package/luci-theme-vela/compile V=s
~~~

### Install on a running router

Copy the package directory into the buildroot, build the apk/ipk, then install it.
Alternatively copy htdocs, ucode and root to the router and run:

~~~sh
uci set luci.themes.Vela=/luci-static/vela
uci set luci.main.mediaurlbase=/luci-static/vela
uci commit luci
/etc/init.d/rpcd restart
~~~

Then hard-refresh the browser. To return to the previous theme:

~~~sh
uci set luci.main.mediaurlbase=/luci-static/shadcn
uci commit luci
~~~

## Notes

- The dashboard is implemented as an extra status include
  (htdocs/luci-static/resources/view/status/include/zz_vela_dashboard.js), so it does
  not overwrite any core LuCI view. The standard overview sections are hidden only after
  the dashboard renders successfully.
- WAN traffic is sampled from the WAN device counters on each status poll (5 s).
- The theme uses the Inter font and Lucide icons bundled with the shadcn base.

## Credits

- [luci-theme-shadcn](https://github.com/eamonxg/luci-theme-shadcn) - base shell, CSS
  architecture and LuCI integration (Apache-2.0).
- [Lucide](https://github.com/lucide-icons/lucide) - icons.
- [OpenWrt LuCI](https://github.com/openwrt/luci) - LuCI runtime and status includes.

## License

Apache-2.0. See LICENSE and NOTICE.