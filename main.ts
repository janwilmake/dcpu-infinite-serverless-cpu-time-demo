// src/index.ts
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
    primes: number[];
    startTime: number;
    running: boolean;
  };
  private controller: AbortController | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.data = {
      primes: [],
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
      this.data.primes = [];

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
          primeCount: this.data.primes.length,
          lastPrime:
            this.data.primes.length > 0
              ? this.data.primes[this.data.primes.length - 1]
              : null,
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
        // Find the next prime number (CPU-intensive operation)
        this.findNextPrime();

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

  // Find the next prime number with deliberately CPU-intensive operations
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
        for (let j = 0; j < 5000; j++) {
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
}
