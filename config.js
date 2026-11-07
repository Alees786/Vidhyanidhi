// Paste the Web app URL from Apps Script (Deploy > Manage deployments). It ends with /exec
const API_URL = 'https://script.google.com/macros/s/AKfycbzo9VrgqOJoG6fzNTla0mlz7TsQ4qn3cijhPUQYSmrhd4h9DOHNCUy9JS8v4rHELQhGng/exec';

// Maintenance page: set on to true, commit to GitHub, and everyone sees the "Under Maintenance" page.
// Open the site with ?preview at the end of the address to use it normally while testing.
const MAINTENANCE = {
  on: true,
  message: 'We are updating the system. Please check back shortly.',
  until: 'Expected back by 15-11-2026, 6:00 PM'
};
