import {
  OrderCreateInput,
  type OrderDetail,
  type OrderIdParams,
  type OrdersListQuery,
  type OrdersListResult,
  OrderScheduleInput,
  type OrderSummary,
  OrderTransitionInput,
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
import { OrdersService } from './orders.service';

type Transition = z.output<typeof OrderTransitionInput>;

@Controller()
export class OrdersController {
  private readonly orders: OrdersService;

  constructor(orders: OrdersService) {
    this.orders = orders;
  }

  @Endpoint(routes.ordersList)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractQuery() query: OrdersListQuery,
  ): Promise<OrdersListResult> {
    return this.orders.list(user, membership, query);
  }

  @Endpoint(routes.ordersCreate)
  create(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @Body() input: z.output<typeof OrderCreateInput>,
  ): Promise<OrderSummary> {
    return this.orders.create(user, membership, input);
  }

  @Endpoint(routes.orderGet)
  get(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractParams() params: OrderIdParams,
  ): Promise<OrderDetail> {
    return this.orders.get(user, membership, params.id);
  }

  @Endpoint(routes.orderAccept)
  accept(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractParams() params: OrderIdParams,
    @Body() input: Transition,
  ): Promise<OrderSummary> {
    return this.orders.step(user, membership, params.id, 'accept', input);
  }

  @Endpoint(routes.orderReject)
  reject(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractParams() params: OrderIdParams,
    @Body() input: Transition,
  ): Promise<OrderSummary> {
    return this.orders.step(user, membership, params.id, 'reject', input);
  }

  @Endpoint(routes.orderSchedule)
  schedule(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractParams() params: OrderIdParams,
    @Body() input: z.output<typeof OrderScheduleInput>,
  ): Promise<OrderSummary> {
    return this.orders.schedule(user, membership, params.id, input);
  }

  @Endpoint(routes.orderCancel)
  cancel(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: MembershipContext,
    @ContractParams() params: OrderIdParams,
    @Body() input: Transition,
  ): Promise<OrderSummary> {
    return this.orders.step(user, membership, params.id, 'cancel', input);
  }
}
