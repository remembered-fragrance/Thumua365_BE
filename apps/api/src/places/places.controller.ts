import {
  type Place,
  type PlaceDeleteResult,
  type PlaceIdParams,
  PlaceInput,
  PlacePatch,
  type PlacesList,
  PlacesQuery,
  routes,
} from '@mambo/contracts';
import { Body, Controller } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { ContractParams, ContractQuery } from '../common/contract-query';
import { Endpoint } from '../common/endpoint';
import { RequestId } from '../common/request-id';
import { PlacesService } from './places.service';

@Controller()
export class PlacesController {
  private readonly places: PlacesService;

  constructor(places: PlacesService) {
    this.places = places;
  }

  @Endpoint(routes.placesList)
  listInView(@CurrentUser() user: AuthUser, @ContractQuery() query: z.output<typeof PlacesQuery>): Promise<PlacesList> {
    return this.places.listInView(user, query.bbox, query.kinds);
  }

  @Endpoint(routes.placeGet)
  get(@CurrentUser() user: AuthUser, @ContractParams() params: PlaceIdParams): Promise<Place> {
    return this.places.get(user, params.id);
  }

  @Endpoint(routes.orgPlacesList)
  listForOrg(@CurrentUser() user: AuthUser, @CurrentMembership() m: MembershipContext): Promise<PlacesList> {
    return this.places.listForOrg(user, m);
  }

  @Endpoint(routes.orgPlaceCreate)
  create(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @Body() input: z.output<typeof PlaceInput>,
    @RequestId() requestId: string,
  ): Promise<Place> {
    return this.places.create(user, m, input, requestId);
  }

  @Endpoint(routes.orgPlaceUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @ContractParams() params: PlaceIdParams,
    @Body() patch: z.output<typeof PlacePatch>,
    @RequestId() requestId: string,
  ): Promise<Place> {
    return this.places.update(user, m, params.id, patch, requestId);
  }

  @Endpoint(routes.orgPlaceDelete)
  async remove(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @ContractParams() params: PlaceIdParams,
    @RequestId() requestId: string,
  ): Promise<PlaceDeleteResult> {
    await this.places.remove(user, m, params.id, requestId);
    return { ok: true };
  }
}
