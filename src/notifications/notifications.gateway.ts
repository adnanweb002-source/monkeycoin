import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import * as cookie from 'cookie';
import { ConfigService } from '@nestjs/config';
import { ALLOWED_BROWSER_ORIGINS } from '../config/allowed-origins';

@WebSocketGateway({
  cors: {
    origin: ALLOWED_BROWSER_ORIGINS,
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private jwtService: JwtService, private cfg: ConfigService) {}

  async handleConnection(client: Socket) {
    try {
      const rawCookie = client.handshake.headers.cookie;

      this.logger.log(
        `New client connected to notifications gateway: ${client.id}`,
      );

      if (!rawCookie) {
        return client.disconnect();
      }

      const parsed = cookie.parse(rawCookie);

      const token = parsed['access_token'];

      if (!token) {
        this.logger.warn('No access token found in cookies');
        return client.disconnect();
      }

      const payload = this.jwtService.verify(token, {
        secret: this.cfg.get<string>('JWT_ACCESS_SECRET'),
      });

      this.logger.log(
        `User connected to notifications gateway: ${payload.sub}`,
      );

      client.join(`user_${payload.sub}`);
    } catch (err) {
      this.logger.error(`Error during WebSocket connection: ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {}

  emitToUser(userId: number, payload: any) {
    this.logger.log(`Emitting notification to user ${userId}: ${payload.title}`);
    this.server.to(`user_${userId}`).emit('notification', payload);
  }
}