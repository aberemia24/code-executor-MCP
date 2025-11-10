/**
 * Streaming Proxy for Real-Time Output
 *
 * Provides WebSocket endpoint for streaming console.log output during execution.
 * Critical for ADHD users who need immediate feedback for long-running tasks.
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';

/**
 * Streaming proxy that broadcasts execution output via WebSocket
 */
export class StreamingProxy {
  private wss: WebSocketServer | null = null;
  private server: http.Server | null = null;
  private port = 0;
  private clients: Set<WebSocket> = new Set();

  /**
   * Start WebSocket server on random port
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      // Create HTTP server for WebSocket upgrade
      this.server = http.createServer();

      // Create WebSocket server
      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws: WebSocket) => {
        this.clients.add(ws);

        ws.on('close', () => {
          this.clients.delete(ws);
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          this.clients.delete(ws);
        });
      });

      // Listen on random port
      this.server.listen(0, 'localhost', () => {
        const address = this.server!.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          resolve(this.port);
        } else {
          reject(new Error('Failed to get streaming server port'));
        }
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Broadcast output chunk to all connected clients
   */
  broadcast(chunk: string): void {
    const data = JSON.stringify({
      type: 'output',
      content: chunk,
      timestamp: Date.now(),
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (error) {
          console.error('Failed to send to client:', error);
          this.clients.delete(client);
        }
      }
    }
  }

  /**
   * Broadcast execution complete event
   */
  broadcastComplete(success: boolean): void {
    const data = JSON.stringify({
      type: 'complete',
      success,
      timestamp: Date.now(),
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (error) {
          console.error('Failed to send completion to client:', error);
        }
      }
    }
  }

  /**
   * Get WebSocket connection URL
   */
  getUrl(): string {
    return `ws://localhost:${this.port}`;
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Stop WebSocket server and close all connections
   */
  async stop(): Promise<void> {
    // Close all client connections
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();

    // Close WebSocket server
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          if (this.server) {
            this.server.close(() => resolve());
          } else {
            resolve();
          }
        });
      } else if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
