/**
 * Creates a URL for navigating to a specific page in the app
 * @param {string} pageName - The name of the page to navigate to
 * @returns {string} The URL path for the page
 */
export function createPageUrl(pageName) {
  return `/${pageName}`;
}