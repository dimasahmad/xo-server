{$wait} = require '../fibers-utils'

#=====================================================================

exports.delete = ->
  params = @getParams {
    id: { type: 'string' }
  }

  # Current user must be an administrator.
  @checkPermission 'admin'

  try
    VDI = @getObject params.id
  catch
    @throw 'NO_SUCH_OBJECT'

  xapi = @getXAPI VDI

  # TODO: check if VDI is attached before
  $wait xapi.call "VDI.destroy", VDI.ref

  return

exports.set = ->
  params = @getParams {
    # Identifier of the VDI to update.
    id: { type: 'string' }

    name_label: { type: 'string', optional: true }

    name_description: { type: 'string', optional: true }

    # size of VDI
    size: { type: 'integer' }
  }

  # Current user must be an administrator.
  @checkPermission 'admin'

  try
    VDI = @getObject params.id
  catch
    @throw 'NO_SUCH_OBJECT'

  xapi = @getXAPI VDI

  {ref} = VDI

  # Size.
  if 'size' of params
    {size} = params

    if size < VDI.size
      @throw(
        'INVALID_SIZE'
        "cannot set new size below the current size (#{VDI.size})"
      )

    $wait xapi.call 'VDI.resize_online', ref, "#{size}"

  # Other fields.
  for param, fields of {
    'name_label'
    'name_description'
  }
    continue unless param of params

    for field in (if $isArray fields then fields else [fields])
      $wait xapi.call "VDI.set_#{field}", ref, "#{params[param]}"

  return
