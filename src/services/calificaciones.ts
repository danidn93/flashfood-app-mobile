import { supabase } from '../lib/supabase'

export type CalificacionRestaurante = {
  local_id: string
  promedio: number
  total_calificaciones: number
}

type CalificacionDB = {
  local_id: string
  promedio: number | string | null
  total_calificaciones: number | string | null
}

export async function obtenerCalificacionesRestaurantes(
  localesIds: string[],
): Promise<Record<string, CalificacionRestaurante>> {
  const ids = [...new Set(localesIds.filter(Boolean))]

  if (ids.length === 0) {
    return {}
  }

  const { data, error } = await supabase
    .from('v_app_calificacion_restaurantes')
    .select('local_id, promedio, total_calificaciones')
    .in('local_id', ids)

  if (error) {
    throw new Error(
      `No se pudieron obtener las calificaciones: ${error.message}`,
    )
  }

  const resultado: Record<string, CalificacionRestaurante> = {}

  for (const registro of (data ?? []) as CalificacionDB[]) {
    const promedio = Number(registro.promedio ?? 0)
    const total = Number(registro.total_calificaciones ?? 0)

    resultado[registro.local_id] = {
      local_id: registro.local_id,
      promedio: Number.isFinite(promedio) ? promedio : 0,
      total_calificaciones: Number.isFinite(total) ? total : 0,
    }
  }

  return resultado
}

export function formatearCalificacion(
  calificacion: CalificacionRestaurante | null | undefined,
): string {
  if (!calificacion || calificacion.total_calificaciones === 0) {
    return 'Sin calificaciones'
  }

  return `${calificacion.promedio.toFixed(1)} (${calificacion.total_calificaciones})`
}
