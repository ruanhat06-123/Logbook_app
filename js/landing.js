const readCookie = (name) => document.cookie.split("; ").find((item) => item.startsWith(`${name}=`));
const hasCachedAccount = () => {
  if (readCookie("logmate_email")) return true;
  return Object.keys(localStorage).some((key) => {
    if (!key.startsWith("sb-")) return false;
    try {
      return Boolean(JSON.parse(localStorage.getItem(key))?.user?.email);
    } catch {
      return false;
    }
  });
};

if (hasCachedAccount()) window.location.replace("html/login.html");
