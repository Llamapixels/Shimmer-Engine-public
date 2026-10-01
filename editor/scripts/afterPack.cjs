// electron-builder afterPack hook. The Mac build isn't signed with an
// Apple Developer ID, and electron-builder leaves it with a broken
// signature once our toolchain is added to the bundle - Apple Silicon
// then reports the app as "damaged". An ad-hoc signature (codesign -s -)
// keeps it valid, so users only get the usual "unidentified developer"
// prompt (right-click > Open the first time).
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
