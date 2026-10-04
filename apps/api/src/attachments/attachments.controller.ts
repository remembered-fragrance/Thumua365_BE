import { type AttachmentDownloadUrl, type AttachmentIdParams, AttachmentUploadInput, type AttachmentUploadUrl, routes } from '@mambo/contracts';
import { Body, Controller } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentMembership } from '../auth/current-membership';
import { CurrentUser } from '../auth/current-user';
import type { MembershipContext } from '../auth/membership';
import { ContractParams } from '../common/contract-query';
import { Endpoint } from '../common/endpoint';
import { AttachmentsService } from './attachments.service';

@Controller()
export class AttachmentsController {
  private readonly attachments: AttachmentsService;

  constructor(attachments: AttachmentsService) {
    this.attachments = attachments;
  }

  @Endpoint(routes.attachmentsUploadUrl)
  uploadUrl(@CurrentMembership() m: MembershipContext, @Body() input: z.output<typeof AttachmentUploadInput>): Promise<AttachmentUploadUrl> {
    return this.attachments.uploadUrl(m, input);
  }

  @Endpoint(routes.attachmentUrl)
  downloadUrl(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() m: MembershipContext,
    @ContractParams() params: AttachmentIdParams,
  ): Promise<AttachmentDownloadUrl> {
    return this.attachments.downloadUrl(user, m, params.id);
  }
}
