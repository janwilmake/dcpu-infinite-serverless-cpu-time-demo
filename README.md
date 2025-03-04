# Durable Central Processing Unit - perform infinite CPU operations without interuption, on serverless.

After [figuring out](https://x.com/irvinebroque/status/1896942190997483664) both queues and schedules DON'T actually possess the ability to do up to [900s of CPU time but just 30](https://developers.cloudflare.com/workers/platform/limits/), Kenton shared we can use a durable object with infinite CPU time without interuption.

Let's make an independent example where this is done.

This approach essentially "cheats" the 30-second CPU limit by creating a continuous operation that can run for hours or even days, limited only by memory constraints and the reliability of the ping mechanism.

## Context:

> Jan: A cap of 30 seconds CPU-time is not acceptable for serverless. Crazy that this is still the highest cloudflare will go! Vercel offers up to 300s though on pro, so likely, I'll go with that, bit it's dangerously expensive if it goes wrong 🫠 Anyone knows if enterprise offers higher limits on CPU-time at Cloudflare?

> Rita: are you actually running into the limit, or concerned about it? genuinely asking as we've had very few use cases (if any?) of folks hitting 30s CPU (not wall-time) limit

> Jan: Yes im hitting it! My use case is that I'm trying to parse a large tar (json.gz) file that I download from elsewhere and then decompress. The file is up to 2GB decompressed and I need to JSON parse every line, then do things with it. The problem is that, since it's a tar file, it can't be done in chunks but needs to be decompressed from the start, so I can't distribute this over multiple worker calls or queue messages (I've tried). I also seem to hit the same limit when doing a cronjob, within a minute of running that job, even though it says the CPU time should be 15 minute max there, this doesn't seem to be the case. It all works locally (both in a worker, in a queue, or in a scheduler) but on cloudflare it fails for the larger ones (success if the file is small enough to be done in 30s)

> Brendan: You’re sure you’re not hitting memory limits here? DMing you but I wonder if cron thing you’re bringing up is an error code that covers both CPU time exceeded and exceeded memory. Interesting use case, have a few ideas

> Kenton: Even if we increased the CPU time limit, such large batch jobs have a high risk of being interrupted for other random reasons, and restarting multi-minute operations from scratch is unfortunate. Some sort of checkpointing really helps here. I wonder if you could have a Durable Object pull the file. You could keep track of progress in local storage, so that if you have to retry the operation, you can skip forward (at least, skip the JSON parsing) up to where you left off? A client Worker can then send peridic messages to the DO to get progress updates, which will also have the effect of topping up the DO's CPU time limit. So in most cases it'll just run to completion, but if not, it can resume without redoing everything.

> Jan: Oh this is interesting. So if I do it in a durable object, it can just keep going, as long as I send a check-in request within every 30 seconds? that resets the cpu limit, without interrupting the streaming and parsing of that file? Checkpointing is possible, but if I can avoid that it'd be nice, since it's a lot of extra complexity, and I feel I'm not going over the 30s THAT much.

> Kenton: Yes, as long as you are doing _some_ I/O and are thus able to receive the messages coming from the client, then the CPU limit will be topped back up to 30s each time, allowing the concurrent download to continue uninterrupted. If you're in a total CPU busy loop like `while (true) {}` then you won't receive the messages from the client and will get cut off at 30s, but it sounds like that's not what's happening here.

> Jan: Oh this is great thanks Kenton, I will try it and let you know if it worked. It seems DO is always the answer somehow ^^

# Specification:

I want a typescript cloudflare worker that has a durable object that performs CPU heavy operation and does not stop, that grows a JS object in memory. It should accept a GET request /ping and send back the intermediate state. Ensure the CPU operations are heavy, and go on for at least 5 minutes. The worker fetch entrypoint initiates the DO and pings it every second to see the intermediate state, and streams this back in a ReadableStream so I can curl it.

# Result:

I'll create a Cloudflare Worker with a Durable Object that performs CPU-heavy operations continuously while allowing periodic pings to check its state. The solution includes streaming the intermediate state back to the client.

## How It Works

This implementation creates a Cloudflare Worker with a Durable Object that performs CPU-intensive operations without interruption. Here's how it works:

1. **Main Worker (`index.ts`)**:

   - Handles incoming requests
   - Creates a Durable Object instance when a request to `/start` is received
   - Sets up a streaming response to the client
   - Pings the Durable Object every second for 5 minutes to get its current state
   - Each ping refreshes the Durable Object's CPU time limit

2. **Durable Object (`DurableCPUProcessor`)**:

   - Performs CPU-intensive calculations (finding prime numbers, calculating Fibonacci numbers)
   - Maintains state in memory, continuously growing the data structures
   - Yields control periodically using `await new Promise(resolve => setTimeout(resolve, 0))` to allow handling of incoming ping requests
   - Responds to ping requests with its current state
   - Estimates memory usage by creating temporary objects

3. **Key Features**:
   - The Durable Object can run indefinitely because each `/ping` request resets the 30-second CPU limit
   - The main worker streams results back to the client in real-time
   - CPU-intensive operations are made artificially heavier with extra calculations
   - The implementation includes a way to stop the process (via `/stop` endpoint)

## How to Test with cURL

To test this implementation, deploy it to Cloudflare Workers and then use the following cURL command:

```bash
curl -N http://localhost:3000/start
```

The `-N` flag is important as it disables buffering, allowing you to see the streamed results in real-time.

## Key Implementation Notes

1. **CPU Time Extension**: The Durable Object's CPU time limit gets reset every time it receives a ping request, allowing it to run indefinitely.

2. **CPU-Intensive Tasks**: The implementation includes deliberately CPU-intensive tasks like finding prime numbers with extra calculations, computing Fibonacci numbers, and creating large objects in memory.

3. **Yielding Control**: The code includes strategic pauses (`setTimeout(resolve, 0)`) to yield control to the event loop, allowing it to process incoming ping requests.

4. **Memory Growth**: The object grows in memory by storing all calculated primes and Fibonacci numbers, and by estimating its own memory usage.

5. **Monitoring**: The Worker streams updates back to the client, showing the current state of the calculations and memory usage.

This approach demonstrates how Durable Objects can be used for long-running CPU tasks on Cloudflare Workers, circumventing the standard 30-second CPU time limit.
