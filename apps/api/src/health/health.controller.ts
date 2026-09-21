import { type Health, routes } from '@mambo/contracts';
import { Controller, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Endpoint } from '../common/endpoint';
import { ENV, type Env } from '../config/env';
import { API_VERSION } from '../version';

@Controller()
export class HealthController {
  private readonly env: Env;

  constructor(@Inject(ENV) env: Env) {
    this.env = env;
  }

  /** Nơi chạy container gọi liên tục để biết API còn sống — không tính vào hạn mức. */
  @SkipThrottle()
  @Endpoint(routes.health)
  health(): Health {
    return {
      status: 'ok',
      version: API_VERSION,
      commit: this.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
      env: this.env.APP_ENV,
    };
  }
}
