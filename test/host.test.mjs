import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runHostTurn } from '../src/host.mjs';
import { revisionFor } from '../src/world-files.mjs';

function modelResponse(message) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('host provides a manifest and executes an on-demand read/write loop', async (context) => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-host-'));
  await mkdir(path.join(world, 'game'));
  await mkdir(path.join(world, 'world', 'characters'), { recursive: true });
  await mkdir(path.join(world, 'world', 'player'));

  const playerBefore = '# Hero\n\nPINNED_PLAYER_FACT: carrying a lantern\n';
  const playerAfter = '# Hero\n\nPINNED_PLAYER_FACT: carrying a lantern\n\nKnown: Mara trusts the player.\n';
  await writeFile(
    path.join(world, 'game', 'state.md'),
    '# Game State\n\n- **Present:** [[Bram]]\n\n## Player Character\n- **PC:** Hero — a plain-text entry\n- **Location:** [[Test Quay]]\n\n## Clocks\nNone.\n'
  );
  await writeFile(path.join(world, 'game', 'log.md'), '# Chronicle\n');
  await writeFile(path.join(world, 'world', 'player', 'Hero.md'), playerBefore);
  await writeFile(path.join(world, 'world', 'Test Quay.md'), '# Test Quay\n\nPINNED_PLACE_FACT\n');
  await writeFile(
    path.join(world, 'world', 'characters', 'Mara.md'),
    '# Mara\n\nPRIVATE_PERSONA_FACT: Mara speaks in clipped sentences.\n'
  );
  await writeFile(
    path.join(world, 'world', 'characters', 'Bram.md'),
    '# Bram\n\nPINNED_PRESENT_FACT: Bram is the harbourmaster.\n'
  );

  const requests = [];
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return modelResponse({
        role: 'assistant',
        content: null,
        reasoning_details: [{ type: 'reasoning.text', text: 'private reasoning' }],
        tool_calls: [{
          id: 'call-read-character',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: 'world/characters/Mara.md' })
          }
        }]
      });
    }
    if (requests.length === 2) {
      return modelResponse({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-read-player',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: 'world/player/Hero.md' })
          }
        }]
      });
    }
    if (requests.length === 3) {
      return modelResponse({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-write-player',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({
              path: 'world/player/Hero.md',
              content: playerAfter,
              expected_revision: revisionFor(playerBefore),
              reason: 'Record earned trust.'
            })
          }
        }]
      });
    }
    return modelResponse({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call-finish',
        type: 'function',
        function: {
          name: 'finish_turn',
          arguments: JSON.stringify({
            narration: 'At [[Test Quay]], Mara gives you a curt nod. What do you do?',
            state_changed: true
          })
        }
      }]
    });
  };

  const narration = await runHostTurn({
    apiKey: 'test-key',
    model: 'test-model',
    basePrompt: 'You are the host.',
    worldDir: world,
    publicHistory: [
      { role: 'assistant', content: 'Begin.' },
      { role: 'user', content: 'I help Mara.' }
    ]
  });

  assert.equal(narration, 'At Test Quay, Mara gives you a curt nod. What do you do?');
  assert.equal(requests.length, 4);
  const firstSystem = requests[0].messages[0].content;
  assert.match(firstSystem, /world\/characters\/Mara\.md/u);
  assert.match(firstSystem, /PINNED_PLAYER_FACT/u);
  assert.match(firstSystem, /PINNED_PLACE_FACT/u);
  assert.match(firstSystem, /PINNED_PRESENT_FACT/u);
  assert.doesNotMatch(firstSystem, /PRIVATE_PERSONA_FACT/u);

  const secondMessages = requests[1].messages;
  assert.deepEqual(
    secondMessages.find((message) => Array.isArray(message.tool_calls)).reasoning_details,
    [{ type: 'reasoning.text', text: 'private reasoning' }]
  );
  assert.match(
    secondMessages.find((message) => message.role === 'tool').content,
    /PRIVATE_PERSONA_FACT/u
  );
  assert.equal(await readFile(path.join(world, 'world', 'player', 'Hero.md'), 'utf8'), playerAfter);
});

test('host accepts non-empty direct narration as a completed turn', async (context) => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-finish-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return modelResponse({ role: 'assistant', content: '  The rain eases. What do you do?  ' });
  };

  const result = await runHostTurn({
    apiKey: 'test-key',
    model: 'test-model',
    basePrompt: 'You are the host.',
    worldDir: world,
    publicHistory: [{ role: 'user', content: 'I wait.' }]
  });
  assert.equal(result, 'The rain eases. What do you do?');
  assert.equal(calls, 1);
});

test('host retries a transient provider failure without changing the transcript', async (context) => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-retry-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '0' }
      });
    }
    return modelResponse({ role: 'assistant', content: 'The fog parts. What do you do?' });
  };

  const result = await runHostTurn({
    apiKey: 'test-key',
    model: 'test-model',
    basePrompt: 'You are the host.',
    worldDir: world,
    publicHistory: [{ role: 'user', content: 'I wait.' }],
    sleep: async () => {}
  });
  assert.equal(result, 'The fog parts. What do you do?');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].messages, requests[1].messages);
});

test('host does not retry a rejected provider request', async (context) => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-rejected-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' }
    });
  };

  await assert.rejects(
    runHostTurn({
      apiKey: 'test-key',
      model: 'test-model',
      basePrompt: 'You are the host.',
      worldDir: world,
      publicHistory: [{ role: 'user', content: 'I wait.' }],
      sleep: async () => {}
    }),
    (error) => error.code === 'MODEL_REJECTED' && error.retryable === false
  );
  assert.equal(calls, 1);
});

test('host bounds repeated transient provider failures', async () => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-outage-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  let calls = 0;
  let delays = 0;

  await assert.rejects(
    runHostTurn({
      apiKey: 'test-key',
      model: 'test-model',
      basePrompt: 'You are the host.',
      worldDir: world,
      publicHistory: [{ role: 'user', content: 'I wait.' }],
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError('connection reset');
      },
      sleep: async () => {
        delays += 1;
      }
    }),
    (error) => error.code === 'MODEL_UNAVAILABLE' && error.retryable === true
  );
  assert.equal(calls, 3);
  assert.equal(delays, 2);
});

test('host preserves a staged write while retrying the next model request', async () => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-write-retry-'));
  const before = '# Player\n\nCarrying: rope\n';
  const after = '# Player\n\nCarrying: rope and a brass key\n';
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  await mkdir(path.join(world, 'world', 'player'), { recursive: true });
  await writeFile(path.join(world, 'world', 'player', 'Hero.md'), before);
  const requests = [];
  let calls = 0;

  const result = await runHostTurn({
    apiKey: 'test-key',
    model: 'test-model',
    basePrompt: 'You are the host.',
    worldDir: world,
    publicHistory: [{ role: 'user', content: 'I take the key.' }],
    fetchImpl: async (_url, options) => {
      calls += 1;
      requests.push(JSON.parse(options.body));
      if (calls === 1) {
        return modelResponse({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'write-key',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'world/player/Hero.md',
                content: after,
                expected_revision: revisionFor(before),
                reason: 'Record the acquired brass key.'
              })
            }
          }]
        });
      }
      if (calls === 2) throw new TypeError('connection reset');
      return modelResponse({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'finish-key',
          type: 'function',
          function: {
            name: 'finish_turn',
            arguments: JSON.stringify({ narration: 'The brass key is yours. What do you do?' })
          }
        }]
      });
    },
    sleep: async () => {}
  });

  assert.equal(result, 'The brass key is yours. What do you do?');
  assert.equal(await readFile(path.join(world, 'world', 'player', 'Hero.md'), 'utf8'), after);
  assert.deepEqual(requests[1].messages, requests[2].messages);
  assert.equal(
    requests[2].messages.filter((message) => message.role === 'tool').length,
    1
  );
});

test('dice results are stable when the same turn is retried', async () => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-dice-retry-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  const diceArgs = { count: 2, sides: 20, modifier: 1, reason: 'Cross the slick roof' };

  async function playOnce() {
    let calls = 0;
    let roll;
    await runHostTurn({
      apiKey: 'test-key',
      model: 'test-model',
      basePrompt: 'You are the host.',
      worldDir: world,
      publicHistory: [{ role: 'user', content: 'I cross the roof.' }],
      turnId: 'ceff384a-fad8-4fc1-9ca2-e7e78a23c34f',
      fetchImpl: async (_url, options) => {
        calls += 1;
        const request = JSON.parse(options.body);
        if (calls === 1) {
          return modelResponse({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'roll-roof',
              type: 'function',
              function: { name: 'roll_dice', arguments: JSON.stringify(diceArgs) }
            }]
          });
        }
        roll = JSON.parse(request.messages.findLast((message) => message.role === 'tool').content);
        return modelResponse({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'finish-roof',
            type: 'function',
            function: {
              name: 'finish_turn',
              arguments: JSON.stringify({ narration: 'You find your footing. What do you do?' })
            }
          }]
        });
      }
    });
    return roll;
  }

  assert.deepEqual(await playOnce(), await playOnce());
});

function sseResponse(chunks) {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const textChunk = (text) => ({ choices: [{ delta: { content: text } }] });

test('streamed narration arrives as ordered deltas and becomes the turn result', async () => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-stream-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  const events = [];
  let requestBody;

  const result = await runHostTurn({
    apiKey: 'test-key',
    model: 'test-model',
    basePrompt: 'You are the host.',
    worldDir: world,
    publicHistory: [{ role: 'user', content: 'I wait.' }],
    onEvent: (event) => events.push(event),
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return sseResponse([
        textChunk('The fog '),
        textChunk('parts at [[Test Quay]].'),
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ]);
    }
  });

  assert.equal(requestBody.stream, true);
  assert.ok(!requestBody.tools.some((tool) => tool.function.name === 'finish_turn'));
  assert.deepEqual(events, [
    { type: 'delta', text: 'The fog ' },
    { type: 'delta', text: 'parts at [[Test Quay]].' }
  ]);
  assert.equal(result, 'The fog parts at Test Quay.');
});

test('preamble before a tool call is withdrawn and split tool arguments are assembled', async () => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-stream-tools-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  const events = [];
  const requests = [];

  const result = await runHostTurn({
    apiKey: 'test-key',
    model: 'test-model',
    basePrompt: 'You are the host.',
    worldDir: world,
    publicHistory: [{ role: 'user', content: 'I climb the wall.' }],
    turnId: 'b3a1c2d4-1111-4222-8333-444455556666',
    onEvent: (event) => events.push(event),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.length === 1) {
        return sseResponse([
          textChunk('Let me roll for that.'),
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'roll-1', function: { name: 'roll_dice', arguments: '{"count":2,"sides":6,' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"modifier":1,"reason":"Climb the wall"}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
        ]);
      }
      return sseResponse([textChunk('You haul yourself over the top.')]);
    }
  });

  assert.equal(result, 'You haul yourself over the top.');
  assert.deepEqual(events, [
    { type: 'delta', text: 'Let me roll for that.' },
    { type: 'reset' },
    { type: 'delta', text: 'You haul yourself over the top.' }
  ]);
  const toolMessage = requests[1].messages.find((message) => message.role === 'tool');
  const roll = JSON.parse(toolMessage.content);
  assert.equal(roll.ok, true);
  assert.equal(roll.notation, '2d6+1');
});

test('text streamed by a failed request is withdrawn before the retry', async () => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-stream-retry-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  const events = [];
  let calls = 0;

  const result = await runHostTurn({
    apiKey: 'test-key',
    model: 'test-model',
    basePrompt: 'You are the host.',
    worldDir: world,
    publicHistory: [{ role: 'user', content: 'I wait.' }],
    onEvent: (event) => events.push(event),
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return sseResponse([textChunk('The rain be'), { error: { message: 'upstream reset' } }]);
      }
      return sseResponse([textChunk('The rain begins.')]);
    }
  });

  assert.equal(result, 'The rain begins.');
  assert.deepEqual(events, [
    { type: 'delta', text: 'The rain be' },
    { type: 'reset' },
    { type: 'delta', text: 'The rain begins.' }
  ]);
});

test('whitespace before a tool call never reaches the player', async () => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-stream-ws-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  const events = [];
  let calls = 0;

  await runHostTurn({
    apiKey: 'test-key',
    model: 'test-model',
    basePrompt: 'You are the host.',
    worldDir: world,
    publicHistory: [{ role: 'user', content: 'I look around.' }],
    onEvent: (event) => events.push(event),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return sseResponse([
          textChunk('\n'),
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'read-1', function: { name: 'read_file', arguments: '{"path":"game/state.md"}' } }] } }] }
        ]);
      }
      return sseResponse([textChunk('\n\n'), textChunk('Dust drifts '), textChunk('over the road.')]);
    }
  });

  assert.deepEqual(events, [
    { type: 'delta', text: 'Dust drifts ' },
    { type: 'delta', text: 'over the road.' }
  ]);
});

test('streamed reasoning fragments are merged into whole blocks for the history', async () => {
  const world = await mkdtemp(path.join(os.tmpdir(), 'rpg-ai-stream-reasoning-'));
  await mkdir(path.join(world, 'game'));
  await writeFile(path.join(world, 'game', 'state.md'), '# Game State\n');
  const requests = [];
  const fragment = (text) => ({
    choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text, format: 'unknown', index: 0 }] } }]
  });

  await runHostTurn({
    apiKey: 'test-key',
    model: 'test-model',
    basePrompt: 'You are the host.',
    worldDir: world,
    publicHistory: [{ role: 'user', content: 'I roll.' }],
    onEvent: () => {},
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.length === 1) {
        return sseResponse([
          fragment('The player '),
          fragment('wants a roll.'),
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'r1', function: { name: 'roll_dice', arguments: '{"count":1,"sides":20,"modifier":0,"reason":"A roll"}' } }] } }] }
        ]);
      }
      return sseResponse([textChunk('You roll.')]);
    }
  });

  const assistant = requests[1].messages.find((message) => Array.isArray(message.tool_calls));
  assert.deepEqual(assistant.reasoning_details, [
    { type: 'reasoning.text', text: 'The player wants a roll.', format: 'unknown', index: 0 }
  ]);
});
