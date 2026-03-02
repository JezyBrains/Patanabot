import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync, promises as fs } from 'fs';
import { join } from 'path';
import { execSync, exec } from 'child_process';
import { performance } from 'perf_hooks';
import { promisify } from 'util';

const execAsync = promisify(exec);
const TEMP_DIR = join(process.cwd(), 'data', 'temp_audio_bench');
if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
}

const ITERATIONS = 10;
const DUMMY_PCM_SIZE = 1024 * 100; // 100KB dummy PCM
const dummyPcm = Buffer.alloc(DUMMY_PCM_SIZE, 'a');

let totalLag = 0;
let lagCount = 0;

function measureLag() {
    const start = performance.now();
    setImmediate(() => {
        const end = performance.now();
        const lag = end - start;
        totalLag += lag;
        lagCount++;
        measureLag();
    });
}

async function runBenchmarkSync() {
    console.log('--- Starting Synchronous Benchmark ---');

    totalLag = 0;
    lagCount = 0;
    measureLag();

    const startTime = performance.now();

    for (let i = 0; i < ITERATIONS; i++) {
        const timestamp = Date.now() + i;
        const pcmPath = join(TEMP_DIR, `bench_sync_${timestamp}.pcm`);
        const oggPath = join(TEMP_DIR, `bench_sync_${timestamp}.ogg`);

        writeFileSync(pcmPath, dummyPcm);

        try {
            execSync(`sleep 0.05`);
        } catch (e) {
            const startBusy = Date.now();
            while(Date.now() - startBusy < 50) {}
        }

        writeFileSync(oggPath, dummyPcm);
        readFileSync(oggPath);

        try { unlinkSync(pcmPath); } catch(e) {}
        try { unlinkSync(oggPath); } catch(e) {}
    }

    const endTime = performance.now();

    await new Promise(resolve => setTimeout(resolve, 50));

    console.log(`Sync Benchmark total time: ${(endTime - startTime).toFixed(2)}ms`);
    console.log(`Average Event Loop Lag (Sync): ${(totalLag / lagCount).toFixed(2)}ms`);
    console.log('--------------------------------------\n');
}

async function runBenchmarkAsync() {
    console.log('--- Starting Asynchronous Benchmark ---');

    totalLag = 0;
    lagCount = 0;
    measureLag();

    const startTime = performance.now();

    const tasks = [];
    for (let i = 0; i < ITERATIONS; i++) {
        tasks.push((async () => {
            const timestamp = Date.now() + i;
            const pcmPath = join(TEMP_DIR, `bench_async_${timestamp}.pcm`);
            const oggPath = join(TEMP_DIR, `bench_async_${timestamp}.ogg`);

            await fs.writeFile(pcmPath, dummyPcm);

            try {
                await execAsync(`sleep 0.05`);
            } catch (e) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            await fs.writeFile(oggPath, dummyPcm);
            await fs.readFile(oggPath);

            try { await fs.unlink(pcmPath); } catch(e) {}
            try { await fs.unlink(oggPath); } catch(e) {}
        })());
    }

    await Promise.all(tasks);

    const endTime = performance.now();

    await new Promise(resolve => setTimeout(resolve, 50));

    console.log(`Async Benchmark total time: ${(endTime - startTime).toFixed(2)}ms`);
    console.log(`Average Event Loop Lag (Async): ${(totalLag / lagCount).toFixed(2)}ms`);
    console.log('--------------------------------------\n');
}

async function run() {
    await runBenchmarkSync();
    await runBenchmarkAsync();
    process.exit(0);
}

run();
