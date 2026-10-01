import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LivekitService } from './livekit/service';
import { RoomStateService } from './room-state/room-state.service';
import { RoomStateStore } from './room-state/room-state.store';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: process.env.DOTENV_CONFIG_PATH || '.env',
    }),
  ],
  controllers: [AppController],
  providers: [AppService, LivekitService, RoomStateService, RoomStateStore],
})
export class AppModule {}
