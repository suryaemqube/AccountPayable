// Voucher workflow statuses — codes match parameter_details.code for parameterid=1
export const VS = {
  DRAFT:          'draft',
  ASSIGNED:       'assigned',
  APPROVED:       'approved',       // manager approved
  REVIEWED:       'reviewed',       // approver reviewed
  EXPORTED:       'exported',       // exported to bank file
  READY_TO_REMIT: 'ready_to_remit', // ready to remit to supplier
  PAID:           'paid',           // payment done
  REJECTED:       'rejected',
};
