import { type EventsTrackResult, routes } from '@mambo/contracts';
import { Body, Controller, Headers } from '@nestjs/common';
import { Endpoint } from '../common/endpoint';
import { EventsService } from './events.service';

@Controller()
export class EventsController {
  private readonly events: EventsService;

  constructor(events: EventsService) {
    this.events = events;
  }

  /** Route công khai: guard không đọc token — service tự xác thực nếu có, sai thì coi như ẩn danh. */
  @Endpoint(routes.eventsTrack)
  track(
    @Body() body: { readonly events: readonly unknown[] },
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
  ): Promise<EventsTrackResult> {
    return this.events.track(body.events, authorization, organizationId);
  }
}
