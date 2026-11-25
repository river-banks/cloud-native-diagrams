# Google Cloud product icons

Source: Google's official Google Cloud icon library, https://cloud.google.com/icons, file
`google-cloud-icons.zip` (the console icon set) from
https://cloud.google.com/static/icons/files/google-cloud-icons.zip, sha256
`a6d9d7921758042538b462f03cf64614c2cebd96743b3ed63580a769fc7de3e9`, fetched 2026-11-07 by
`badges/vendor.py gcp`. Only editor metadata was stripped and ids prefixed; the art is unchanged.

Terms: the zip carries no licence file. Google's icon page offers the icons "for your diagrams,
technical documentation, and more", which is the only use made of them here. The icons and product
names are Google trademarks: use an icon only to name that Google Cloud product, next to its name,
and do not alter it or suggest Google endorses the diagram.

Google also publishes newer "core product" and "category" icon zips on services.google.com; that host
was not reachable from the sandbox that built these, so this set is the console set. Swap the source in
`vendor.py` (GCP_ZIP, GCP_SHA256) to move to the newer art.
