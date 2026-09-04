import "../core/app.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

const questions = [
  ["How do I create an account?", "From the LogMate landing page, choose Create account. Enter your first name, surname, email address, and a password with at least 8 characters, including an uppercase letter, a lowercase letter, and a number. Submit the form to create your account, then sign in."],
  ["How do I log in?", "Choose Log in from the landing page, or open the login page directly. Enter the email address and password associated with your LogMate account, then select Sign in."],
  ["How do I add a vehicle?", "Open My vehicles from the navigation and choose Add vehicle. Enter the number plate, make, model, current mileage, and optional year and service mileage details. Select Add vehicle to save it."],
  ["What vehicle information should I enter?", "Current mileage should be the vehicle's present odometer reading. Last service mileage is the odometer reading at the most recent service. Next service mileage is the reading when the next service is due. These values power the service reminders."],
  ["How do I edit vehicle information?", "Open My vehicles and select the edit icon next to the vehicle. Update the vehicle details and choose Save changes. The vehicle list refreshes after the update."],
  ["How do I remove a vehicle?", "Open My vehicles and select the remove icon next to the vehicle. Confirm the removal only when you are sure, because the vehicle's related logs may also be removed."],
  ["How do I record a fill-up?", "Open New fill-up, choose a vehicle, and enter the current mileage, fuel amount, price per litre, fuel type, and date. You can also add the station or location. LogMate calculates the total and can calculate consumption when previous mileage is available."],
  ["How is the fuel price populated?", "When you choose a fuel type, LogMate checks the latest regional price in the fuel-price cache for your browser region. The suggested price is placed in the price field and remains editable."],
  ["How do I change the suggested fuel price?", "Click the price per litre field and enter the price charged by your garage. Your manually entered value is used for the saved fill-up and the total calculation."],
  ["How is fuel consumption calculated?", "LogMate compares the current mileage with the mileage at the previous fill-up. If fuel amount and distance are available, it calculates both consumption in litres per 100 kilometres and efficiency in kilometres per litre. You can override these values manually."],
  ["How do I record a trip?", "Open New trip and choose a vehicle. Select Personal or Business, enter the date, start and end odometer readings, origin, destination, and purpose, then choose Save trip. The vehicle's current mileage is updated to the trip's end mileage."],
  ["How do I start and end a trip automatically?", "On New trip, select a vehicle and choose Start trip. Allow location access when your browser asks. LogMate records your starting position and sends a notification with an End trip action. When you finish, choose End trip in the notification or on the trip page. LogMate captures your ending position, calculates the driving distance, saves the trip, and updates the vehicle mileage."],
  ["How does automatic trip distance work?", "Enter or select both the origin and destination. LogMate searches locations and requests a driving route, then adds the route distance to the start odometer to populate the end odometer. You can still adjust the end reading manually before saving."],
  ["How do I use map search in a trip?", "Choose Open map beside Origin or Destination. Type at least two characters in the map search field. Matching locations appear in a dropdown; select one to place the marker, then choose Use this point."],
  ["What if automatic trip distance does not work?", "Check that both locations are selected from suggestions or map results, and that the browser has an internet connection. You can enter valid start and end odometer readings manually. If the map service is unavailable, the manual readings remain available."],
  ["How do I edit a previous trip?", "Open New trip and use the Edit a previous trip dropdown above the form. Select a trip, change its vehicle, date, locations, mileage, type, or purpose, then choose Save trip. The existing trip is updated rather than duplicated."],
  ["How do service reminders work?", "Set a next service mileage on a vehicle. LogMate shows a reminder when the vehicle is within the reminder distance or overdue. After servicing the vehicle, choose Confirm serviced and enter the new next service mileage."],
  ["How do I add a service record?", "Open My vehicles, choose Service history for the vehicle, complete the service title, date, mileage, invoice amount, and notes, then choose Save service record. You can add a service manually at any time."],
  ["How do I add a service when I confirm a reminder?", "When a service reminder appears, choose Confirm serviced and enter the next service mileage. LogMate updates the vehicle reminder and records the completed service in that vehicle's service history."],
  ["Can I upload service photos and invoices together?", "Yes. In a service record, use the Invoices or photos field and select one or more files. You can upload photos, PDF invoices, or a combination of both in the same service record."],
  ["How do I view service history?", "Open My vehicles and choose Service history for a vehicle. Each record shows the service date, work title, mileage, invoice amount, notes, and links to its uploaded files."],
  ["How do I download or print service history?", "Open the vehicle's Service history panel and choose Download CSV for a spreadsheet-friendly copy or Print report for a print-ready report. The report includes the vehicle details and recorded service entries."],
  ["How do I change the theme?", "Open Settings and use the Appearance control to switch between light and dark mode. Your choice is saved in this browser and applies across LogMate pages."],
  ["How do I choose a default vehicle?", "Open Settings, find Popular settings, and choose a Default vehicle. LogMate preselects that vehicle on new trip and fill-up forms. A vehicle-specific link from the vehicle list takes priority."],
  ["How do I choose a default trip type?", "Open Settings and choose Personal or Business under Default trip type. The selected type is preselected whenever you open a new trip form."],
  ["How do I manage service notifications?", "Open Settings and enable or disable Service reminder notifications. When enabled, your browser may ask for notification permission. Notifications can also be blocked in the browser's site permissions."],
  ["How do I change my email?", "Open Settings, enter the new email address under Account details, and choose Update email. Supabase may require confirmation before the new address becomes active."],
  ["How do I change my password?", "Open Settings and enter your current password, new password, and confirmation. Your current password is checked before the change is submitted. The new password must meet the displayed security requirements."],
  ["How do I reset a forgotten password?", "Choose Forgot password on the login page, enter your email address, and check your inbox. Follow the reset link, enter and confirm a new password, then sign in again. Reset links are single-use and expire."],
  ["How do fuel reports work?", "Fuel reports summarize fill-ups, costs, litres, mileage, and consumption. Use the available filters to focus on a vehicle or date range, then review the totals and table."],
  ["How do trip reports work?", "Trip reports summarize recorded journeys, including vehicle, date, trip type, purpose, origin, destination, odometer readings, and distance. Use the filters to review a specific vehicle or period."],
  ["Where is my data stored?", "Your account data is stored in the connected Supabase project and is filtered by your signed-in account. Sign out when using a shared device."],
  ["Why can I not see my vehicles or trips?", "Confirm that you are signed into the correct account, refresh the page, and check your connection. Each account only displays records associated with that account."],
  ["How do I install LogMate as a Chrome app?", "Open LogMate over HTTPS in Chrome, then use the install icon in the address bar or Chrome's menu. The installed app uses the LogMate logo and opens in a standalone window."],
];

await shell("help", `
  <header class="topbar"><div><div class="eyebrow">Support</div><h1>How can we help?</h1></div><div class="top-date"><strong>LOGMATE HELP</strong>Search the answers</div></header>
  <section class="card help-panel">
    <div class="field"><label for="help-search">Search questions</label><input id="help-search" type="search" placeholder="Search by keyword" autocomplete="off"></div>
    <div id="help-results" class="help-results"></div>
  </section>
`);

const searchInput = document.querySelector("#help-search");
const results = document.querySelector("#help-results");
const renderQuestions = () => {
  const query = searchInput.value.trim().toLowerCase();
  const matches = questions.filter(([question, answer]) =>
    `${question} ${answer}`.toLowerCase().includes(query),
  );
  results.innerHTML = matches.length
    ? matches.map(([question, answer]) => `<details class="help-item"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join("")
    : '<div class="empty">No matching questions.</div>';
};
searchInput.addEventListener("input", renderQuestions);
renderQuestions();