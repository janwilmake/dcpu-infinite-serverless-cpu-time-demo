# Unlimited CPU Time in Serverless: A Cloudflare Durable Objects Hack

A few days ago, I [tweeted](https://x.com/janwilmake/status/1896963056204443759) about a frustrating limitation with serverless platforms: the dreaded CPU time cap. After digging into this problem, I discovered an interesting workaround using Cloudflare's Durable Objects that I'm excited to share with you all.

## The Problem: 30-Second CPU Time Limit

For one of my projects, I needed to process a large tar file (containing JSON.gz files) that could be up to 2GB when decompressed. The process involved:

1. Downloading the file
2. Decompressing it
3. Parsing each JSON line
4. Processing the data

Because it's a tar file, this process can't easily be split into chunks - you need to decompress from the start. I kept hitting Cloudflare's 30-second CPU time limit, even when:

- Running it in a standard Worker
- Using a Queue consumer
- Trying with a Scheduled task

The confusing part was that Cloudflare's docs mention a 900-second limit for Queues and Scheduled tasks, but in practice, I still hit the 30-second CPU barrier. I [later learned](https://x.com/irvinebroque/status/1896942190997483664) that the 900s applies to wall-clock time, not CPU time.

Vercel offers 300s CPU time on their Pro plan, but that's expensive if it goes wrong and you accidentally burn through compute minutes!

## The Solution: Durable Objects to the Rescue

While discussing this on Twitter, Kenton Varda from Cloudflare shared an intriguing workaround:

> Even if we increased the CPU time limit, such large batch jobs have a high risk of being interrupted for other random reasons, and restarting multi-minute operations from scratch is unfortunate. Some sort of checkpointing really helps here. I wonder if you could have a Durable Object pull the file. You could keep track of progress in local storage, so that if you have to retry the operation, you can skip forward (at least, skip the JSON parsing) up to where you left off? A client Worker can then send peridic messages to the DO to get progress updates, which will also have the effect of topping up the DO's CPU time limit. So in most cases it'll just run to completion, but if not, it can resume without redoing everything.

This was a revelation! The key insight is that Durable Objects' CPU time limit gets reset every time they receive a request. So if you periodically "ping" the DO, you can effectively extend its CPU time indefinitely.

After confirming with Kenton:

> Yes, as long as you are doing _some_ I/O and are thus able to receive the messages coming from the client, then the CPU limit will be topped back up to 30s each time, allowing the concurrent download to continue uninterrupted. If you're in a total CPU busy loop like `while (true) {}` then you won't receive the messages from the client and will get cut off at 30s, but it sounds like that's not what's happening here.

## The Implementation: DCPU Package

To show this concept working, I created DCPU (Durable Central Processing Unit), a package that demonstrates how to achieve "infinite" CPU time in a serverless environment. Here's how it works:

1. **Main Worker**:

   - Creates a Durable Object instance
   - Sets up a streaming response to the client
   - Pings the DO every second to get its status
   - Streams the status back in real-time

2. **Durable Object**:
   - Performs CPU-intensive work (in the demo, finding prime numbers)
   - Maintains state in memory
   - Crucially, it periodically yields control using `await new Promise(resolve => setTimeout(resolve, 0))` to allow handling of incoming ping requests
   - Responds to ping requests with its current state

The "trick" is that each ping request resets the 30-second CPU limit, allowing your long-running task to continue as long as you need.

## Demo in Action

For the demo, I implemented a prime number finder that runs continuously:

```typescript
// CPU-intensive task that will run continuously but yield to allow pings
protected async task(signal: AbortSignal, env: Env) {
  try {
    while (!signal.aborted) {
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
        this.status = `Primes found: ${this.data.primes.length}`;
        break;
      }
      // Yield to allow handling of incoming pings (crucial for extending CPU time)
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    console.error("Error in CPU task:", error);
  }
}
```

The key points:

1. We make the task CPU-intensive with extra calculations
2. The `await new Promise((resolve) => setTimeout(resolve, 0))` call is essential - it yields control to the event loop, allowing the DO to process incoming ping requests
3. Each ping resets the 30-second CPU timer

You can test it by running:

```bash
curl -N http://localhost:3000/start
```

The `-N` flag disables buffering so you can see the real-time output.

## When to Use This Approach

This technique is perfect for:

1. Processing large files that can't be easily chunked
2. CPU-intensive data transformations
3. Long-running calculations that exceed 30 seconds
4. Anything where restarting from scratch would be painful

## Limitations and Gotchas

A few things to keep in mind:

1. **Yield frequently**: You must yield control regularly with `setTimeout(resolve, 0)` or the DO won't be able to process pings
2. **Memory constraints**: DOs are still limited by memory, so watch your memory usage
3. **Cost considerations**: While this extends CPU time, you're still paying for compute usage
4. **Reliability**: You need a reliable client to keep sending pings

## Conclusion

Cloudflare's 30-second CPU limit for serverless functions is a significant constraint for many workloads. While an official increase to this limit would be welcome, this "pingable DO" approach provides a pragmatic workaround.

This approach essentially "cheats" the 30-second CPU limit by creating a continuous operation that can run for hours or even days, limited only by memory constraints and the reliability of the ping mechanism.

I've published this technique as a package called "DCPU" which you can use in your own projects. Check out the [repository](https://github.com/janwilmake/dcpu) for more details.

As the saying goes in the Cloudflare community, Durable Objects somehow always end up being the answer 😄
