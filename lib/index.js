/**
 * Server half of dsh-ipynb-preview.
 *
 * The plugin is browser-only: it registers a document-preview renderer in the
 * web client. This entry point exists so the profile bundle layer can load the
 * package, and it deliberately registers nothing model-facing.
 */
export function apply() {}
