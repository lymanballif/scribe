/** Open the OS photo picker (Photos / Camera / Files on iOS and Android). */
export function pickImageFiles(multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.heic,.heif";
    input.multiple = multiple;
    input.style.display = "none";
    document.body.appendChild(input);
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.onchange = () => finish(Array.from(input.files ?? []));
    // "cancel" fires in modern browsers; fall back to a focus check for the rest.
    input.oncancel = () => finish([]);
    window.addEventListener(
      "focus",
      () => setTimeout(() => input.isConnected && !input.files?.length && finish([]), 600),
      { once: true }
    );
    input.click();
  });
}
