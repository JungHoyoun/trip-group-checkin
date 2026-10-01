import { sha256 } from "js-sha256";

// Convert the entered code to a Firebase-compatible password without storing the code in the app.
export async function teacherPasswordFromCode(code: string): Promise<string> {
  return sha256(`trip-group-checkin:teacher-code:v1:${code}`);
}
