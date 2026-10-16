/**
 * Every test runs on the desktop project; one declared with this (`test(title, PHONE, body)`) runs on the phone project
 * too. Give it to a test that checks what a phone lays out, touches or opens differently: a width, a sheet, the
 * on-screen keyboard. A test of data, access or text checks nothing a viewport can change, and a second run of it
 * only costs time.
 */
export const PHONE = { tag: '@phone' }
