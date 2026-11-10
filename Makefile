# luci-theme-vela: Vela-styled LuCI theme for ImmortalWrt/OpenWrt
# Based on luci-theme-shadcn (Apache-2.0) by eamonxg.
include $(TOPDIR)/rules.mk

LUCI_TITLE:=Vela - a modern LuCI theme with a Vela-styled dashboard
LUCI_DEPENDS:=+luci-base +luci-mod-status
LUCI_PKGARCH:=all

PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0

LUCI_MINIFY_CSS:=

include $(TOPDIR)/feeds/luci/luci.mk

# All frontend assets are committed; no build step is required.
# call BuildPackage - OpenWrt buildroot signature
