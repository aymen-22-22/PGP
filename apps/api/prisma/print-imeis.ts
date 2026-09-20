/** Prints a range of deterministic test IMEIs, one per line, for scanner testing. */
import { testImei } from './test-imei';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 10);
for (let i = from; i <= to; i += 1) console.log(testImei(i));
