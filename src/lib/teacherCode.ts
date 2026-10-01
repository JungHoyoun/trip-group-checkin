// Convert the entered code to a Firebase-compatible password without storing the code in the app.
export async function teacherPasswordFromCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`trip-group-checkin:teacher-code:v1:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
