import { PassThrough } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readAccessToken } from "../auth/routes.js";
import { AuthError, type AuthService } from "../auth/service.js";

export type LibraryChangeReason =
  | "audio_import_completed"
  | "csv_import_item_completed"
  | "external_import_completed";

export interface LibraryChangedPayload {
  reason: LibraryChangeReason;
  songId?: string;
  csvImportBatchId?: string;
  csvImportItemId?: string;
}

export interface LibraryChangedEvent extends LibraryChangedPayload {
  id: string;
  type: "library_changed";
  userId: string;
  createdAt: string;
}

export interface LibraryEventSink {
  emitLibraryChanged(userId: string, payload: LibraryChangedPayload): LibraryChangedEvent;
}

export interface LibraryEventRoutesOptions {
  authService: AuthService;
  eventHub: LibraryEventHub;
  heartbeatMs?: number;
}

type LibraryEventListener = (event: LibraryChangedEvent) => void;

const DEFAULT_LIBRARY_EVENT_HEARTBEAT_MS = 25_000;

export class LibraryEventHub implements LibraryEventSink {
  private readonly listenersByUserId = new Map<string, Set<LibraryEventListener>>();
  private nextEventId = 1;

  subscribe(userId: string, listener: LibraryEventListener) {
    const listeners = this.listenersByUserId.get(userId) ?? new Set<LibraryEventListener>();

    listeners.add(listener);
    this.listenersByUserId.set(userId, listeners);

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0) {
        this.listenersByUserId.delete(userId);
      }
    };
  }

  emitLibraryChanged(userId: string, payload: LibraryChangedPayload) {
    const event: LibraryChangedEvent = {
      ...payload,
      createdAt: new Date().toISOString(),
      id: `${Date.now()}-${this.nextEventId++}`,
      type: "library_changed",
      userId
    };
    const listeners = this.listenersByUserId.get(userId);

    if (!listeners) {
      return event;
    }

    for (const listener of listeners) {
      listener(event);
    }

    return event;
  }
}

export function registerLibraryEventRoutes(
  app: FastifyInstance,
  options: LibraryEventRoutesOptions
) {
  app.get("/api/library/events", async (request, reply) => {
    const user = await authenticate(request, reply, options.authService);

    if (!user) {
      return;
    }

    const stream = new PassThrough();
    const heartbeatMs = options.heartbeatMs ?? DEFAULT_LIBRARY_EVENT_HEARTBEAT_MS;
    let closed = false;

    reply
      .header("content-type", "text/event-stream; charset=utf-8")
      .header("cache-control", "no-cache, no-transform")
      .header("connection", "keep-alive")
      .header("x-accel-buffering", "no");

    writeSseEvent(stream, "connected", {
      connectedAt: new Date().toISOString()
    });

    const unsubscribe = options.eventHub.subscribe(user.id, (event) => {
      writeSseEvent(stream, "library_changed", event, event.id);
    });
    const heartbeat = setInterval(() => {
      stream.write(`: keep-alive ${Date.now()}\n\n`);
    }, heartbeatMs);
    heartbeat.unref();

    const cleanup = () => {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      stream.end();
    };

    request.raw.on("aborted", cleanup);
    reply.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);
    stream.on("close", cleanup);
    stream.on("error", cleanup);

    return reply.send(stream);
  });
}

function writeSseEvent(
  stream: PassThrough,
  eventName: string,
  data: unknown,
  id?: string
) {
  if (id) {
    stream.write(`id: ${id}\n`);
  }

  stream.write(`event: ${eventName}\n`);

  for (const line of JSON.stringify(data).split(/\r?\n/)) {
    stream.write(`data: ${line}\n`);
  }

  stream.write("\n");
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService
) {
  try {
    return await authService.getUserForAccessToken(readAccessToken(request));
  } catch (error) {
    if (error instanceof AuthError) {
      sendLibraryEventError(reply, error.code, error.message, error.statusCode);
      return null;
    }

    throw error;
  }
}

function sendLibraryEventError(
  reply: FastifyReply,
  code: string,
  message: string,
  statusCode: number
) {
  return reply.code(statusCode).send({
    error: code,
    message
  });
}
