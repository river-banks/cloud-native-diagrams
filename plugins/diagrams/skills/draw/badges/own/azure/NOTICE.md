# Microsoft Azure Architecture Icons (not fetched yet)

Source to use: Microsoft's official Azure Architecture Icons,
https://learn.microsoft.com/azure/architecture/icons/, zip `AZURE_ZIP` in `badges/vendor.py`.

Terms (from that page): Microsoft permits the use of these icons in architectural diagrams, training
materials and documentation, and lets you copy, distribute and display them only for that permitted use.
Do not crop, flip, rotate or distort the icons, and include the product name next to the icon. Microsoft
reserves all other rights. Our nodes always print the product name beside the badge, which meets the
naming rule.

Status: the zip's host (arch-center.azureedge.net) was blocked by the network policy of the sandbox
that built this library, so no Azure art is bundled yet. To add it, on a machine that can reach the
host: `python3 badges/vendor.py azure`, pin the printed sha256 as `AZURE_SHA256`, paste the printed
catalogue lines into `badges/catalogue.json`, then `python3 build.py badges && python3 build.py`.
Check the zip's own licence text before committing.
