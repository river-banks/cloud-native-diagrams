# Open-source project icons with no Simple Icons entry or usable cncf/artwork icon

Fetched by `badges/vendor.py` from each project's own repository at the commit pinned in `PROJ`. Where
the file is a logo with a wordmark, the script sets a `viewBox` that crops it to the mark (the box in a
diagram already says the name) and changes nothing else. Each crop keeps the project's own mark whole,
as the project shows it on its own (Velero's disc, Kamaji's walrus, Kube-OVN's octopus, which is also
cncf/artwork's Kube-OVN icon).

- `velero.svg`: https://github.com/vmware-tanzu/velero, `site/static/img/Velero.svg`,
  commit 48b876fe2db639b56a84643bd8fb312049bf9cd5 (Apache-2.0 repository). Velero is a trademark of
  Broadcom (VMware).
- `kamaji.svg`: https://github.com/clastix/kamaji, `assets/logo.svg`,
  commit 60204b0c2b794792dfdc3c7700b4818217a92a95 (Apache-2.0 repository). Kamaji is a trademark of Clastix.
- `kube-ovn.svg`: https://github.com/cncf/artwork, `projects/kube-ovn/stacked/color/kube-ovn-stacked-color.svg`,
  commit bffd512a8b625f15cf5f8e0427469380b5768e90. Kube-OVN is a CNCF project; its logo is provided
  under the Linux Foundation trademark usage guidelines (https://www.linuxfoundation.org/trademark-usage/).
  The cncf/artwork icon file embeds a bitmap, so the all-vector stacked logo is used instead.
- `linstor.svg`: https://github.com/LINBIT/linstor-gui, `public/favicon.svg`,
  commit c8e42c262baeeababbd5f7a4638ae2037399dd75 (GPL-3.0 repository). LINSTOR and LINBIT are
  trademarks of LINBIT.

Use a logo only to name the project in a diagram; do not redraw or recolour it or use it in a way that suggests
endorsement. `badges/vendor.py` only removes metadata, inlines CSS, prefixes ids and crops.
