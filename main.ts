export interface Env {
  DURABLE_CPU: DurableObjectNamespace;
}

// Main Worker entry point
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/start") {
      // Create a new instance of the Durable Object
      const id = env.DURABLE_CPU.newUniqueId();
      const durableObj = env.DURABLE_CPU.get(id);

      // Start the CPU-intensive task
      await durableObj.fetch(new Request("https://dummy-url/start"));

      // Stream the progress back to the client
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      // Function to ping the Durable Object and write the response to the stream
      const pingAndStream = async () => {
        try {
          let count = 0;
          while (true) {
            const response = await durableObj.fetch(
              new Request("https://dummy-url/ping"),
            );
            const text = await response.text();
            await writer.write(
              new TextEncoder().encode(
                `${new Date().toISOString()} - ${text}\n`,
              ),
            );

            // Wait 1 second before the next ping
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Stop after 5 minutes (300 seconds) to prevent indefinite streaming
            count++;
            if (count >= 300) {
              break;
            }
          }
        } catch (error) {
          await writer.write(new TextEncoder().encode(`Error: ${error}\n`));
        } finally {
          await writer.close();
        }
      };

      // Start the ping loop without awaiting it
      ctx.waitUntil(pingAndStream());

      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
        },
      });
    }

    return new Response("Use /start to initiate the CPU-intensive operation", {
      status: 400,
    });
  },
};

// Durable Object implementation
export class DurableCPUProcessor {
  private state: DurableObjectState;
  private data: {
    calculations: number;
    primes: number[];
    fibonacciNumbers: number[];
    memoryUsage: number;
    startTime: number;
    running: boolean;
  };
  private controller: AbortController | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.data = {
      calculations: 0,
      primes: [],
      fibonacciNumbers: [],
      memoryUsage: 0,
      startTime: Date.now(),
      running: false,
    };
  }

  // Handler for fetch requests to the Durable Object
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/start") {
      // If already running, don't start again
      if (this.data.running) {
        return new Response("CPU task already running", { status: 200 });
      }

      this.data.running = true;
      this.data.startTime = Date.now();
      this.data.calculations = 0;
      this.data.primes = [];
      this.data.fibonacciNumbers = [];

      // Create a new abort controller for this run
      this.controller = new AbortController();
      const signal = this.controller.signal;

      // Start the CPU-intensive task without awaiting
      this.startCPUIntensiveTask(signal);

      return new Response("CPU task started", { status: 200 });
    } else if (url.pathname === "/ping") {
      // Return the current state
      const runTimeSeconds = Math.floor(
        (Date.now() - this.data.startTime) / 1000,
      );

      return new Response(
        JSON.stringify({
          running: this.data.running,
          calculations: this.data.calculations,
          primeCount: this.data.primes.length,
          fibCount: this.data.fibonacciNumbers.length,
          lastPrime:
            this.data.primes.length > 0
              ? this.data.primes[this.data.primes.length - 1]
              : null,
          lastFib:
            this.data.fibonacciNumbers.length > 0
              ? this.data.fibonacciNumbers[
                  this.data.fibonacciNumbers.length - 1
                ]
              : null,
          memoryUsageMB:
            Math.round((this.data.memoryUsage / (1024 * 1024)) * 100) / 100,
          runTimeSeconds: runTimeSeconds,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    } else if (url.pathname === "/stop") {
      if (this.controller) {
        this.controller.abort();
        this.controller = null;
      }
      this.data.running = false;
      return new Response("CPU task stopped", { status: 200 });
    }

    return new Response("Invalid endpoint", { status: 400 });
  }

  // CPU-intensive task that will run continuously but yield to allow pings
  private async startCPUIntensiveTask(signal: AbortSignal) {
    try {
      while (!signal.aborted) {
        // Do some CPU-intensive calculations
        // 1. Find prime numbers (a classic CPU-heavy task)
        this.findNextPrime();

        // 2. Calculate Fibonacci numbers
        this.calculateNextFibonacci();

        // 3. Growing object in memory (storing results)
        this.data.calculations++;

        // 4. Estimate memory usage
        this.estimateMemoryUsage();

        // Yield to allow handling of incoming pings (crucial for extending CPU time)
        // This ensures we're not in a tight CPU loop that would prevent pings from being handled
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.error("Error in CPU task:", error);
    } finally {
      this.data.running = false;
    }
  }

  // Find the next prime number
  private findNextPrime() {
    const start =
      this.data.primes.length > 0
        ? this.data.primes[this.data.primes.length - 1] + 1
        : 2;
    let current = start;

    primeSearch: while (true) {
      const sqrt = Math.sqrt(current);

      // Check if current number is divisible by any number up to its square root
      for (let i = 2; i <= sqrt; i++) {
        // Do extra calculations to make this more CPU intensive
        for (let j = 0; j < 1000; j++) {
          (Math.pow(i, 2) * Math.log(current)) / Math.sin(j * 0.01);
        }

        if (current % i === 0) {
          current++;
          continue primeSearch;
        }
      }

      // If we get here, current is prime
      this.data.primes.push(current);
      break;
    }
  }

  // Calculate the next Fibonacci number
  private calculateNextFibonacci() {
    const length = this.data.fibonacciNumbers.length;

    if (length === 0) {
      this.data.fibonacciNumbers.push(0);
    } else if (length === 1) {
      this.data.fibonacciNumbers.push(1);
    } else {
      // Do some extra calculations to make this CPU intensive
      let sum = 0;
      for (let i = 0; i < 5000; i++) {
        sum += Math.tan(i * 0.01) * Math.exp(Math.sin(i * 0.01));
      }

      const nextFib =
        this.data.fibonacciNumbers[length - 1] +
        this.data.fibonacciNumbers[length - 2];
      this.data.fibonacciNumbers.push(nextFib);
    }
  }

  // Estimate memory usage by creating temporary objects
  private estimateMemoryUsage() {
    try {
      // Create a large object to measure
      const tempArray = new Array(100000)
        .fill(0)
        .map((_, i) => ({ index: i, value: Math.random() }));

      // Stringify the data to get a rough estimate of its size
      const jsonString = JSON.stringify(this.data);
      this.data.memoryUsage = jsonString.length;

      // Do something with tempArray to prevent it from being optimized away
      for (let i = 0; i < 1000; i++) {
        tempArray[i % tempArray.length].value += Math.random();
      }
    } catch (e) {
      console.error("Memory estimation error:", e);
    }
  }
}
