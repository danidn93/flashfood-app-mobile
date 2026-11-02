import { App as CapacitorApp } from '@capacitor/app'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  obtenerCarrito,
  registrarAplicacionEnSegundoPlano,
  registrarRegresoRestaurante,
} from '../services/carrito'

type Props = {
  onSolicitarSalida: (destino: string) => void
}

export default function RestaurantExitGuard({
  onSolicitarSalida,
}: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const { sucursalId } = useParams<{ sucursalId: string }>()
  const rutaActual = useRef(location.pathname)
  const solicitarSalidaRef = useRef(onSolicitarSalida)

  useEffect(() => {
    solicitarSalidaRef.current = onSolicitarSalida
  }, [onSolicitarSalida])

  useEffect(() => {
    rutaActual.current = location.pathname
  }, [location.pathname])

  useEffect(() => {
    if (!sucursalId) return

    function manejarClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target

      if (!(target instanceof Element)) return

      const enlace = target.closest('a[href]')

      if (!(enlace instanceof HTMLAnchorElement)) return

      const destino = new URL(enlace.href, window.location.href)

      if (destino.origin !== window.location.origin) return

      if (
        destino.pathname === rutaActual.current ||
        destino.pathname === '/carrito'
      ) {
        return
      }

      const carrito = obtenerCarrito()

      if (
        !carrito ||
        carrito.sucursalId !== sucursalId ||
        carrito.items.length === 0
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      solicitarSalidaRef.current(destino.pathname + destino.search + destino.hash)
    }

    document.addEventListener('click', manejarClick, true)

    return () => {
      document.removeEventListener('click', manejarClick, true)
    }
  }, [sucursalId, navigate])

  useEffect(() => {
    if (!sucursalId) return

    let activo = true
    let eliminarListener: (() => Promise<void>) | undefined

    async function registrarBotonAtras() {
      const listener = await CapacitorApp.addListener(
        'backButton',
        () => {
          const carrito = obtenerCarrito()

          if (
            carrito &&
            carrito.sucursalId === sucursalId &&
            carrito.items.length > 0
          ) {
            solicitarSalidaRef.current('/')
            return
          }

          navigate('/')
        },
      )

      if (!activo) {
        void listener.remove()
        return
      }

      eliminarListener = () => listener.remove()
    }

    void registrarBotonAtras()

    return () => {
      activo = false
      if (eliminarListener) {
        void eliminarListener()
      }
    }
  }, [sucursalId, navigate])

  useEffect(() => {
    if (!sucursalId) return

    let activo = true
    let eliminarListener: (() => Promise<void>) | undefined

    async function registrarEstadoAplicacion() {
      const listener = await CapacitorApp.addListener(
        'appStateChange',
        ({ isActive }) => {
          if (!activo) return

          if (!isActive) {
            const carrito = obtenerCarrito()

            if (
              carrito &&
              carrito.sucursalId === sucursalId &&
              carrito.items.length > 0
            ) {
              registrarAplicacionEnSegundoPlano(sucursalId)
            }
          } else {
            registrarRegresoRestaurante(sucursalId)
          }
        },
      )

      if (!activo) {
        void listener.remove()
        return
      }

      eliminarListener = () => listener.remove()
    }

    void registrarEstadoAplicacion()

    return () => {
      activo = false
      if (eliminarListener) {
        void eliminarListener()
      }
    }
  }, [sucursalId])

  useEffect(() => {
    if (!sucursalId) return

    const rutaRestaurante = window.location.pathname
    const estadoProteccion = {
      ...window.history.state,
      flashfoodRestaurantGuard: sucursalId,
    }

    window.history.pushState(
      estadoProteccion,
      '',
      window.location.href,
    )

    function manejarAtras() {
      const carrito = obtenerCarrito()

      if (
        carrito &&
        carrito.sucursalId === sucursalId &&
        carrito.items.length > 0
      ) {
        window.history.pushState(
          estadoProteccion,
          '',
          rutaRestaurante,
        )

        solicitarSalidaRef.current('/')
        return
      }

      navigate('/', { replace: true })
    }

    window.addEventListener('popstate', manejarAtras)

    return () => {
      window.removeEventListener('popstate', manejarAtras)
    }
  }, [sucursalId, navigate])

  return null
}
