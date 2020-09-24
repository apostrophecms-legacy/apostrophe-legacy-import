## 0.2.0

* Replaced `--blog-2` with `--convert-blog-2-slugs`, which accepts a comma-separated list of 2.x doc types that came from `apostrophe-blog-2` subclasses. Note these must be the *original* type names before mapping. The slugs of these will be converted to have no slashes, but for bc and to prevent conflicts the publication date part is kept, with hyphens. `--blog-2` is still accepted for backwards compatibility, but it only ever worked if you used `blogPost` as the type name after import to 2.x.
* Standard mapping for raw html widgets
* Import lockups
* Import blocks
* Optional overwrite of parked pages on import
* Optional import of global preferences document
* Import nested widgets
* Option to rename slideshow widgets on import while still using their typical mapping function to convert them
* Performance improvements for faster iteration on the import process
* Import crops correctly

## 0.1.0 — 0.1.1

Initial release and bug fix.
